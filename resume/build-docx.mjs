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
  Document, Packer, Paragraph, TextRun, Tab, TabStopType, ExternalHyperlink,
  AlignmentType, BorderStyle, LevelFormat, convertInchesToTwip,
} = docx;

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'jaspersands_resume.docx');

// ---- geometry, mirroring resume.html -------------------------------------
const MARGIN = { top: 0.45, bottom: 0.38, left: 0.5, right: 0.5 };
const CONTENT_W = convertInchesToTwip(8.5 - MARGIN.left - MARGIN.right);
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: CONTENT_W }];

const FONT = 'Times New Roman';
const BODY = 20;   // half-points -> 10pt
const LINE = { line: 235, lineRule: 'exact' };   // 11.75pt, matching the HTML

const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: BODY, ...opts });
const b = (text) => run(text, { bold: true });
const i = (text) => run(text, { italics: true });
const DOT = () => run(' · ');
// Pressable, but deliberately not styled as a link: no colour, no underline.
const link = (text, href, opts = {}) =>
  new ExternalHyperlink({ link: href, children: [run(text, opts)] });

// A left block that can carry mixed formatting, with a date flushed right.
const entryLine = (left, right, spaceBefore = 54) =>
  new Paragraph({
    tabStops: RIGHT_TAB,
    spacing: { before: spaceBefore, ...LINE },
    children: [...left, new TextRun({ children: [new Tab()] }),
              ...(Array.isArray(right) ? right : [run(right)])],
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
    children: [run(text.toUpperCase(), { bold: true, size: 21, characterSpacing: 16 })],
  });

const skill = (label, value) =>
  new Paragraph({
    spacing: { before: 12, ...LINE },
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
        spacing: { after: 30, line: 400, lineRule: 'exact' },
        children: [run('Jasper Sands', { bold: true, size: 38, characterSpacing: 10 })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: 210, lineRule: 'exact' },
        children: [
          run('Palo Alto, CA | (650) 924-8429 | ', { size: 19 }),
          link('jaspersands02@gmail.com', 'mailto:jaspersands02@gmail.com', { size: 19 }),
          run(' | ', { size: 19 }),
          link('jaspersands.com', 'https://jaspersands.com/', { size: 19 }),
          run(' | ', { size: 19 }),
          link('github.com/Jaspersands', 'https://github.com/Jaspersands', { size: 19 }),
          run(' | ', { size: 19 }),
          link('linkedin.com/in/jaspersands', 'https://www.linkedin.com/in/jaspersands', { size: 19 }),
        ],
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
      note([b('Quantum coursework: '), run('Error Correction'), DOT(), run('Engineering'),
            DOT(), run('Simulation & Computing Lab'), DOT(), run('Optimization & ML.')]),
      note([b('TA: '), run('Introduction to Quantum Computing. '), b('MS thesis'), run(' at Diraq and UNSW Sydney.')]),
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
        [link('WhatTheDuck', 'https://github.com/ShayManor/WhatTheDuck', { bold: true }), run(': quantum amplitude estimation for financial Value at Risk'),
         DOT(), i('CUDA-Q, C++')],
        'Overall Winner, iQuHACK 2026', 42
      ),
      bullet([run(
        'Wrote the GPU-accelerated state prep, threshold oracle, and bisection search driving ' +
        'Iterative Quantum Amplitude Estimation.'
      )]),
      bullet([run(
        'Measured query scaling matched the O(1/ε) bound against an O(1/ε²) quasi-Monte Carlo ' +
        'classical baseline.'
      )]),
      entryLine(
        [link('WASM QEC Simulator', 'https://github.com/Jaspersands/quantum-simulator-qec', { bold: true }), run(': surface-code decoding in the browser'),
         DOT(), i('Rust, WebAssembly')],
        [link('qcompiler.jaspersands.com', 'https://qcompiler.jaspersands.com/')]
      ),
      bullet([run(
        'Symplectic stabilizer simulator for rotated and XZZX surface codes, with exact MWPM and ' +
        'Union-Find decoding client-side.'
      )]),
      bullet([run(
        'Finite-size scaling puts the threshold at 3.2% with MWPM, 2.7% with Union-Find, and ' +
        '14.7% under code-capacity noise.'
      )]),
      entryLine(
        [link('Q-Search', 'https://github.com/Jaspersands/qsearch', { bold: true }), run(': proof-gated quantum algorithm research and verification engine')],
        [link('qsearch.jaspersands.com', 'https://qsearch.jaspersands.com/')]
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
        [link('LLM-Based Lossless Text Compression', 'https://github.com/Jaspersands/LLMcompression', { bold: true }), DOT(), i('PyTorch, CUDA')],
        'Systems optimization'
      ),
      bullet([run(
        'Arithmetic coding on LLM predictions: 5–16× average, 39× best case, beating zstd and ' +
        'gzip; static KV caching and CUDA graphs.'
      )]),

      // ---------- research ----------
      heading('Research'),
      entryLine(
        [b('Diraq / UNSW Sydney'), DOT(), i('MS Thesis Research')],
        'Sep 2026 – Jun 2027', 42
      ),
      bullet([run(
        'Automating silicon spin qubit characterization under Dr. Nard Dumoulin Stuyck, replacing ' +
        'manual tuning and interpretation.'
      )]),
      bullet([run(
        'Acquiring charge measurements from cryogenic probing, and classifying device states ' +
        'against what an expert would call by hand.'
      )]),
      entryLine(
        [b('Cidon Systems Research Lab'), run(', Columbia University'), DOT(), i('Graduate Researcher')],
        'Sep 2025 – Jun 2026'
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
        'Reduced hallucination in generative protein modeling under Dr. Venkat Venkatasubramanian, ' +
        'grounded in molecular graph data.'
      )]),
      entryLine(
        [b('Foster Care Policy Database'), run(', Washington University in St. Louis'),
         DOT(), i('Undergraduate Researcher')],
        'Sep 2024 – Jun 2025'
      ),
      bullet([run(
        'Fine-tuned LLaMA-3 with Hugging Face for QA over 50k foster-care policy documents, ' +
        'with human-in-the-loop feedback.'
      )]),


      // ---------- experience ----------
      heading('Experience'),
      entryLine([b('Smack Technologies'), DOT(), i('AI Intern')], 'May – Aug 2026', 42),
      bullet([run(
        'Built physics and sensor simulation, integrating the knowledge graph to expand corpus ' +
        'generation.'
      )]),
      bullet([run(
        'Benchmarked open-weight models head to head on speed, intelligence and concurrency, ' +
        'speeding corpus generation 64x.'
      )]),
      bullet([run(
        'Bounded simulator error to 0.55% against references outside its own tests, in a report ' +
        'that regenerates when the physics changes.'
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
              b('Qualified'), run(', NYU Abu Dhabi Hackathon for Social Good 2027')]),
      bullet([b('Graduate Lead'), run(
        ', Columbia Quantum Algorithms Reading Group: weekly sessions through all 33 chapters ' +
        "of Andrew Childs' notes.")]),

      // ---------- skills ----------
      heading('Skills'),
      skill('Quantum tools:', 'Qiskit and Qiskit Runtime, Cirq, PennyLane, CUDA-Q, Stim, PyMatching, QuTiP'),
      skill('Quantum methods:',
        'Hamiltonian simulation, phase and amplitude estimation, QSVT and block encoding, LCU, ' +
        'VQE, QAOA · randomized benchmarking, tomography, noise modeling · quantum complexity ' +
        '(BQP, QMA), query complexity'),
      skill('Languages:', 'Python, C++, Rust, C, MATLAB, JavaScript, TypeScript, Go, Java'),
      skill('ML & systems:',
        'PyTorch, CUDA, Hugging Face · Linux, Git, Docker, WebAssembly, ' +
        'AWS, GCP, Elasticsearch, LaTeX'),
    ],
  }],
});

writeFileSync(out, await Packer.toBuffer(doc));
console.log('wrote', out);
