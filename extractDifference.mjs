import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuth } from './utils/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authInfo = getAuth();

const startRecord = 1070;
const endRecord = 1071;

const numberOfProcesses = 50;

let processedRows = 0;
let totalRow = 0;

const filePathThreek = './social_files/[Under Testing] _ Missing_socials urls.xlsx';
const threeKSheetName = '2. 3K_HaveData_Report';

let reportFileName = './social_files/Have_to_validate.xlsx';
const filePath9K = './social_files/Validated_missing_socials_9k_image_process.xlsx';
const nineKSheetName = 'To_Migrate_Report';

const extractSlug = (slugString) => {
  if (!slugString) return null;
  return slugString.split('/').pop();
};

async function extractDifference() {
  const workbook3k = new ExcelJS.Workbook();
  await workbook3k.xlsx.readFile(filePathThreek);
  const worksheet3k = workbook3k.getWorksheet(threeKSheetName);

  const workbook9k = new ExcelJS.Workbook();
  await workbook9k.xlsx.readFile(filePath9K);
  const worksheet9k = workbook9k.getWorksheet(nineKSheetName);
  const needValidateWorkSheet = workbook9k.addWorksheet('Have to validate');

  const start = 2;
  const list9kId = [];

  for (let rowNumber = start; rowNumber <= worksheet9k.actualRowCount; rowNumber++) {
    list9kId.push(extractSlug(worksheet9k.getRow(rowNumber).getCell(1).text));
  }

  for (let rowNumber = start; rowNumber <= worksheet3k.actualRowCount; rowNumber++) {
    console.log('adding row');
    if (!list9kId.includes(extractSlug(worksheet3k.getRow(rowNumber).getCell(1).text))) {
      needValidateWorkSheet.addRow(worksheet3k.getRow(rowNumber).values);
    }
  }

  const outputFilePath = path.join(__dirname, reportFileName);
  await workbook9k.xlsx.writeFile(outputFilePath);

  console.log('FINISH');
}

extractDifference();
