import ExcelJS from "exceljs";
import {
  HEADERS,
  HELP_SHEET,
  OPTION_LETTERS,
  QUESTIONS_SHEET,
  TEMPLATE_OPTION_COUNT,
  TYPE_LABELS,
  optionHeader,
} from "./format";

// Rows a teacher can fill in below the examples. The dropdown and text format cover them.
const PREPARED_ROWS = 200;

type Example = {
  type: keyof typeof TYPE_LABELS;
  question: string;
  points: number;
  options: string[];
  correct: string;
  explanation: string;
};

// Real questions, one per type, so the file works as it is: importing the template unchanged
// gives a valid four-question quiz. A test keeps that true.
const EXAMPLES: Example[] = [
  {
    type: "single_choice",
    question: "Which layer of the OSI model routes packets between networks?",
    points: 2,
    options: ["Data link", "Network", "Transport", "Session"],
    correct: "B",
    explanation: "Routers work at the Network layer (layer 3).",
  },
  {
    type: "multiple_choice",
    question: "Which of these are private IPv4 address ranges?",
    points: 3,
    options: ["10.0.0.0/8", "8.8.8.0/24", "192.168.0.0/16", "172.16.0.0/12"],
    correct: "A, C, D",
    explanation: "10/8, 172.16/12 and 192.168/16 are reserved for private networks.",
  },
  {
    type: "true_false",
    question: "A switch normally works at layer 2 of the OSI model.",
    points: 1,
    options: [],
    correct: "True",
    explanation: "Switches forward frames using MAC addresses (layer 2).",
  },
  {
    type: "short_answer",
    question: "What does DNS stand for?",
    points: 1,
    options: [],
    correct: "Domain Name System|Domain Name Service",
    explanation: "Any of the accepted answers counts, ignoring capitals and spacing.",
  },
];

const HELP: [string, string][] = [
  ["How to use this file", ""],
  ["1", 'Fill in one question per row on the "Questions" sheet. Keep the first row (the headers) as it is.'],
  ["2", "Delete the four example rows, or overwrite them. You can leave any number of empty rows below."],
  ["3", "On the Import page, choose this file, the class, a title and the time limit. The quiz is created as a draft: you set the dates and publish it afterwards."],
  ["", ""],
  ["Columns", ""],
  ["Type", "Single choice, Multiple choice, True/False or Short answer (pick from the dropdown)."],
  ["Question", "The question text. Required."],
  ["Points", "A number, for example 1 or 2.5. Leave empty for 1."],
  [`${optionHeader("A")} to ${optionHeader("F")}`, `The answer choices, for the two choice types. Fill them in order (A, then B...). Up to ${OPTION_LETTERS.length} options are allowed: add a column named "Option G" and so on if you need more.`],
  ["Correct answer", "See below: it depends on the type."],
  ["Explanation", "Optional. Shown to students together with their results."],
  ["", ""],
  ["Correct answer, by type", ""],
  ["Single choice", "The letter of the one correct option, for example B."],
  ["Multiple choice", "The letters of every correct option, separated by commas, for example A, C, D."],
  ["True/False", "True or False."],
  ["Short answer", "The accepted answers. Separate several with | or put each on its own line, for example Domain Name System|Domain Name Service. Capitals and extra spaces do not matter."],
  ["", ""],
  ["Rules", ""],
  ["", "A quiz can have at most 100 questions."],
  ["", "Nothing is imported if any row has a problem. You get a list of the rows and what to fix, and can upload again."],
  ["", "Only .xlsx files are accepted (in Excel: File > Save As > Excel Workbook)."],
];

/** The example workbook a teacher downloads and fills in. */
export async function buildTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Quiz Platform";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(QUESTIONS_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  const optionColumns = OPTION_LETTERS.slice(0, TEMPLATE_OPTION_COUNT).map((l) => ({
    header: optionHeader(l),
    width: 22,
  }));
  sheet.columns = [
    { header: HEADERS.type, width: 18 },
    { header: HEADERS.question, width: 52 },
    { header: HEADERS.points, width: 9 },
    ...optionColumns,
    { header: HEADERS.correct, width: 26 },
    { header: HEADERS.explanation, width: 44 },
  ];
  const lastColumn = sheet.columnCount;
  const correctColumn = 4 + TEMPLATE_OPTION_COUNT;

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE7F3" } };
    cell.border = { bottom: { style: "thin" } };
  });

  // Example rows, then empty prepared rows. Text format on the free-text cells keeps Excel from
  // turning "A, C" or "1/2" into something else.
  for (let i = 0; i < PREPARED_ROWS; i++) {
    const row = sheet.getRow(i + 2);
    const example = EXAMPLES[i];
    if (example) {
      row.getCell(1).value = TYPE_LABELS[example.type];
      row.getCell(2).value = example.question;
      row.getCell(3).value = example.points;
      example.options.forEach((text, k) => (row.getCell(4 + k).value = text));
      row.getCell(correctColumn).value = example.correct;
      row.getCell(correctColumn + 1).value = example.explanation;
    }
    for (let c = 2; c <= lastColumn; c++) {
      const cell = row.getCell(c);
      if (c !== 3) cell.numFmt = "@";
      cell.alignment = { vertical: "top", wrapText: true };
    }
    row.getCell(1).alignment = { vertical: "top" };
  }

  // A dropdown for the type, and a check on the points.
  for (let r = 2; r <= PREPARED_ROWS + 1; r++) {
    sheet.getCell(r, 1).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${Object.values(TYPE_LABELS).join(",")}"`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Question type",
      error: "Choose Single choice, Multiple choice, True/False or Short answer.",
    };
    sheet.getCell(r, 3).dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      allowBlank: true,
      formulae: [0],
      showErrorMessage: true,
      errorTitle: "Points",
      error: "Points must be a number, 0 or more.",
    };
  }

  const help = workbook.addWorksheet(HELP_SHEET);
  help.columns = [{ width: 24 }, { width: 110 }];
  for (const [left, right] of HELP) {
    const row = help.addRow([left, right]);
    row.alignment = { vertical: "top", wrapText: true };
    if (right === "" && left !== "" && !/^\d$/.test(left)) row.font = { bold: true, size: 12 };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
