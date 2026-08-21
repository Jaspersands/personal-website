// Renders the same résumé content as resume.html into an editable .docx.
// Apple Pages and Word both open this, so the document stays maintainable by
// hand; resume.html + build.mjs remain the source of truth for the PDF.
//
//   npm i -D docx && node resume/build-docx.mjs

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let docx;
try {
  docx = require('docx');
} catch {
  docx = require(
    require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim() + '/docx'
  );
}
const {
  Document, Packer, Paragraph, TextRun, Tab, TabStopType,
  AlignmentType, BorderStyle, LevelFormat, convertInchesToTwip,
} = docx;

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'jaspersands_resume.docx');

// ---- geometry, mirroring resume.html -------------------------------------
const MARGIN = { top: 0.45, bottom: 0.38, left: 0.5, right: 0.5 };
const CONTENT_W = convertInchesToTwip(8.5 - MARGIN.left - MARGIN.right);
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: CONTENT_W }];

const FONT = 'Times New Roman';
const BODY = 19;   // half-points -> 9.5pt (Word has no 9.4)
const LINE = { line: 221, lineRule: 'exact' };   // 11.05pt, matching the HTML

const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: BODY, ...opts });
const b = (text) => run(text, { bold: true });
const i = (text) => run(text, { italics: true });
const DOT = () => run(' · ');

// A left block that can carry mixed formatting, with a date flushed right.
const entryLine = (left, right, spaceBefore = 54) =>
  new Paragraph({
    tabStops: RIGHT_TAB,
    spacing: { before: spaceBefore, ...LINE },
    children: [...left, new TextRun({ children: [new Tab()] }), run(right)],
  });

const note = (children, spaceBefore = 6) =>
  new Paragraph({ spacing: { before: spaceBefore, ...LINE }, children });

const bullet = (children) =>
  new Paragraph({
    numbering: { reference: 'dot', level: 0 },
    spacing: { before: 12, ...LINE },
    children,
  });

const heading = (text) =>
  new Paragraph({
    spacing: { before: 100, after: 16, ...LINE },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
    children: [run(text.toUpperCase(), { bold: true, size: 18, characterSpacing: 16 })],
  });

const skill = (label, value) =>
  new Paragraph({
    spacing: { before: 20, ...LINE },
    indent: { left: 0 },
    children: [b(label + '  '), run(value)],
  });

// ---- document ------------------------------------------------------------
const doc = new Document({
  numbering: {
    config: [{
      reference: 'dot',
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 180, hanging: 165 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: {
          top: convertInchesToTwip(MARGIN.top),
          bottom: convertInchesToTwip(MARGIN.bottom),
          left: convertInchesToTwip(MARGIN.left),
          right: convertInchesToTwip(MARGIN.right),
        },
      },
    },
    children: [
      // ---------- header ----------
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 30, line: 380, lineRule: 'exact' },
        children: [run('Jasper Sands', { bold: true, size: 36, characterSpacing: 10 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 200, lineRule: 'exact' },
        children: [run(
          'Palo Alto, CA | (650) 924-8429 | jaspersands02@gmail.com | js6908@columbia.edu | ' +
          'jaspersands.com | github.com/Jaspersands | linkedin.com/in/jaspersands',
          { size: 17 }
        )],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, ...LINE },
        children: [run(
          'Quantum algorithms, error correction, and machine learning for qubit control. ' +
          'MS in computer science at Columbia. Thesis at Diraq and UNSW Sydney on ' +
          'automating silicon spin qubit measurement.'
        )],
      }),

      // ---------- education ----------
      heading('Education'),
      entryLine(
        [b('Columbia University'), run(', MS in Computer Science, Quantum Computing Track'),
         DOT(), run('GPA 3.95/4.0')],
        'Sep 2025 – May 2027', 42
      ),
      note([b('Thesis: '), run(
        'automating silicon spin qubit measurement with machine learning. Diraq and UNSW Sydney, ' +
        'Sep 2026 – May 2027, co-supervised by Dr. Nard Dumoulin Stuyck and Dr. Henry Yuen.'
      )]),
      note([b('Coursework: '), run('Quantum Error Correction'), DOT(), run('Quantum Engineering'),
            DOT(), run('Quantum Simulation & Computing Lab'), DOT(), run('Quantum Optimization & ML.')]),
      note([b('TA: '), run('Introduction to Quantum Computing.')]),
      entryLine(
        [b('Washington University in St. Louis'), run(', BS in Computer Science and Economics'),
         DOT(), run('GPA 3.81/4.0')],
        'Aug 2021 – May 2025'
      ),
      note([b('Coursework: '), run('Machine Learning'), DOT(), run('Analysis of Algorithms'),
            DOT(), run('Computer Security. '), b('TA: '),
            run('Malware Analysis; Parallel Programming.')]),

      // ---------- projects ----------
      heading('Selected Projects'),
      entryLine(
        [b('WhatTheDuck'), run(': quantum amplitude estimation for financial Value at Risk'),
         DOT(), i('CUDA-Q, C++')],
        'Overall Winner, iQuHACK 2026', 42
      ),
      bullet([run(
        'Wrote the GPU-accelerated state preparation, threshold oracle, and bisection search driving ' +
        'Iterative Quantum Amplitude Estimation.'
      )]),
      bullet([run(
        'Measured query scaling matched the O(1/ε) bound against an O(1/ε²) quasi-Monte Carlo ' +
        'classical baseline.'
      )]),
      entryLine(
        [b('WASM QEC Simulator'), run(': surface-code decoding in the browser'),
         DOT(), i('Rust, WebAssembly')],
        'qcompiler.jaspersands.com'
      ),
      bullet([run(
        'Symplectic stabilizer simulator for rotated and XZZX surface codes, with exact MWPM and ' +
        'Union-Find decoding running client-side.'
      )]),
      bullet([run(
        'Finite-size scaling over d = 3, 5, 7 at 20k shots/point puts the phenomenological ' +
        'threshold at 3.2%.'
      )]),
      entryLine(
        [b('Q-Search'), run(': proof-gated quantum algorithm research and verification engine')],
        'qsearch.jaspersands.com'
      ),
      bullet([run(
        'Automated search for structural quantum advantage on non-abelian HSP, dihedral coset, and ' +
        'linear code equivalence problems.'
      )]),
      bullet([run(
        'Formal proof gates test each mechanism against 1,200+ classical baselines across 720+ ' +
        'theorem modules, indexing negative results.'
      )]),
      entryLine(
        [b('LLM-Based Lossless Text Compression'), DOT(), i('PyTorch, CUDA')],
        'Systems optimization'
      ),
      bullet([run(
        'Arithmetic coding on LLM predictions: 5–16× average, 39× best case, beating zstd and ' +
        'gzip; static KV caching and CUDA graphs.'
      )]),

      // ---------- research ----------
      heading('Research'),
      entryLine(
        [b('Cidon Systems Research Lab'), run(', Columbia University'), DOT(), i('Graduate Researcher')],
        'Sep 2025 – Jun 2026', 42
      ),
      bullet([run(
        'Built phishing and spam detection pipelines with Dr. Asaf Cidon and Barracuda Networks, ' +
        'combining language-model embeddings with production email telemetry and tuning for precision ' +
        'against a fixed false-positive budget.'
      )]),
      entryLine(
        [b('Complex Resilient Intelligent Systems Lab'), run(', Columbia University'),
         DOT(), i('Graduate Researcher')],
        'May – Dec 2025'
      ),
      bullet([run(
        'Reduced hallucination in generative protein modeling under Dr. Venkat Venkatasubramanian by ' +
        'grounding outputs in molecular graph data.'
      )]),
      entryLine(
        [b('Foster Care Policy Database'), run(', Washington University in St. Louis'),
         DOT(), i('Undergraduate Researcher')],
        'Sep 2024 – Jun 2025'
      ),
      bullet([run(
        'Fine-tuned LLaMA-3 with Unsloth and Hugging Face for QA over 50k foster-care policy documents, ' +
        'with human-in-the-loop feedback.'
      )]),
      note([b('Also: '), b('Desdr Open Insurance Toolkit'), run(
        ', Columbia (Dr. Eugene Wu, Sep–Dec 2025): survey data into actuarial and ' +
        'climate-risk features.')], 42),

      // ---------- experience ----------
      heading('Experience'),
      entryLine([b('Smack Technologies'), DOT(), i('Software Engineer Intern')], 'May – Aug 2026', 42),
      bullet([run(
        'Built a high-fidelity physics and sensor simulation core: closed-form line-of-sight and ' +
        'horizon geometry, energy-maneuverability flyout, and ECI-to-ECEF coordinate transforms.'
      )]),
      bullet([run(
        'Synced platform capability data from a knowledge graph into the simulator via a ' +
        'retrieval-judged, human-approved pipeline.'
      )]),
      entryLine([b('Highnote'), DOT(), i('Cybersecurity Engineer Intern')], 'May – Jul 2024'),
      bullet([run(
        'Designed and deployed the company-wide SIEM for a card-issuing fintech, unifying AWS, GCP, ' +
        'and Datadog telemetry into one Elasticsearch cluster ingesting over 1 TB/day, and wrote 100+ ' +
        'rule-based and ML anomaly detections.'
      )]),
      entryLine([b('Mindtrip'), DOT(), i('Software Engineer Intern')], 'May – Jul 2023'),
      bullet([run(
        'Built internal admin and secure-query tooling in JavaScript and Rails via Retool, saving ' +
        'roughly 250 engineering hours a month.'
      )]),

      // ---------- honors ----------
      heading('Honors & Leadership'),
      bullet([b('Overall Winner'), run(' and '), b('NVIDIA Ecosystem Award'), run(', MIT iQuHACK 2026'),
              DOT(), b('Audience Favorite'), run(', Harmoniqs Quantum Design 2026'), DOT(),
              b('Runner-Up'), run(', Qualcomm Snapdragon Multiverse 2026'), DOT(),
              run('Qualified, NYU Abu Dhabi Quantum Hackathon for Social Good 2027')]),
      bullet([b('Graduate Lead'), run(
        ', Columbia Quantum Algorithms Reading Group (Sep 2025–Jun 2026): ran weekly sessions ' +
        "covering all 33 chapters of Andrew Childs' quantum algorithms lecture notes, each with " +
        'simulation checks.')]),

      // ---------- skills ----------
      heading('Skills'),
      skill('Quantum:',
        'Qiskit and Qiskit Runtime, CUDA-Q, Stim, PyMatching, QuTiP · Hamiltonian simulation, ' +
        'phase and amplitude estimation, QSVT, LCU, VQE, QAOA · surface codes, MWPM and Union-Find ' +
        'decoding · randomized benchmarking, tomography'),
      skill('Languages:', 'Python, C++, Rust, C, MATLAB, JavaScript, TypeScript, Go, Java'),
      skill('ML & systems:',
        'PyTorch, CUDA, Hugging Face · Linux, Git, Docker, WebAssembly, ' +
        'AWS, GCP, Elasticsearch, LaTeX'),
      skill('Mathematics:',
        'Linear algebra, tensor networks, probability, convex optimization, quantum ' +
        'complexity (BQP, QMA), query complexity'),
    ],
  }],
});

writeFileSync(out, await Packer.toBuffer(doc));
console.log('wrote', out);
