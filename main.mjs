import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio'; // ✅ Replace linkedom with cheerio
import fs from 'fs/promises';
import { FORBIDDEN, SERVER_ERROR, ResponseType, RETRY_CV } from './constant.mjs';
import { refreshAuthToken, getAuth } from './utils/auth.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credential = 'testrec@brightsource.com/12qwaszx';
const authInfo = getAuth();

const beginRecord = 0;
const endRecord = 0;
const numberOfProcesses = 65;

let processedRows = 0;
let totalRow = 0;
const uploadedFilePath = './Original_report.xlsx';
let toCheckSheetName = 'To be migrated';
let reportSheetName = 'To be migrated_Report';
let reportFileName = 'Validated_migrated_Original.xlsx';

const getEmailsAndPhone = (stringValue) => {
  if (!stringValue || stringValue === '[]') return null;
  return stringValue
    .replace(/[\[\]'"]/g, '')
    .split(',')
    .map((email) => email.trim());
};

const isValidEmails = (emailString) => {
  const emails = getEmailsAndPhone(emailString);
  if (emails === null) {
    return null;
  }
  return emails.every((email) => validator.isEmail(email));
};

const isValidPhones = (phoneString) => {
  const phones = getEmailsAndPhone(phoneString);
  if (phones === null) {
    return null;
  }
  const last9DigitsSet = new Set();

  for (let phone of phones) {
    if (!validator.isNumeric(phone)) return false;
    const last9Digits = phone.slice(-9);
    if (last9DigitsSet.has(last9Digits)) return false;
    last9DigitsSet.add(last9Digits);
  }
  return true;
};

const extractSlug = (slugString) => {
  if (!slugString) return null;
  return slugString.split('/').pop();
};

function checkContainReversedEmail(emailString, htmlString) {
  const [localPart, domainPart] = emailString.split('@');
  const email = `@${domainPart}${localPart}`;

  return htmlString.toLowerCase().includes(email.toLowerCase());
}

// Function to check if the profile CV exists
const checkCVExists = async (slug, { emails, phones }, excelFileObject, rowNumber) => {
  console.log('emails', emails);
  console.log('calling api');
  try {
    let errorMessage = '';
    const url = `https://employer.brightsource.com/api/profiles/${slug}/cv-for-edit`;
    const response = await axios.post(url, null, {
      headers: {
        Authorization: authInfo.token,
      },
    });
    let responseData = response.data.data.data;

    if (!responseData || !responseData.length) {
      console.log('Abnormal response returned');
      return RETRY_CV;
    }

    const textContent = loadTextContentByCheerio(responseData);
    const cleanedText = textContent.replace(/\s+|-/g, '').trim();

    if (response.status === 524) {
      return ResponseType.SERVER_TIMEOUT;
    }
    if (!cleanedText) {
      return ResponseType.EMPTY_RESPONSE;
    }
    if (cleanedText.includes('File Is Corrupted')) {
      return ResponseType.FILE_IS_CORRUPTED;
    }
    if (
      emails &&
      emails.some(
        (email) =>
          !cleanedText.toLowerCase().includes(email.toLowerCase()) && !checkContainReversedEmail(email, cleanedText),
      )
    ) {
      errorMessage = ResponseType.WRONG_EMAIL;
    }
    if (phones && phones.some((phone) => !cleanedText.includes(phone.slice(-5)))) {
      errorMessage += ResponseType.WRONG_PHONE;
    }
    console.log('Successful checked CV for slug: ', slug);
    console.log('Processing row: ', rowNumber);

    // await new Promise(resolve => setTimeout(resolve, delay));
    return errorMessage;
  } catch (error) {
    if (error.status === FORBIDDEN) {
      await refreshAuthToken();
      console.log('Processing Row: ', rowNumber);
      console.log(ResponseType.FORBIDDEN);
      return RETRY_CV;
    }
    if (error.status === SERVER_ERROR) {
      // const outputFilePath = path.join(__dirname, "Validated_" + path.basename(uploadedFilePath));
      // await excelFileObject.xlsx.writeFile(outputFilePath);
      console.log('Processing Row: ', rowNumber);
      console.log('SERVER ERROR');
      return ResponseType.SERVER_ERROR;
      // process.exit();
    }
    console.error('ERROR bug', error.status);
    console.error(`Error fetching CV exist status for slug: ${slug}`, error);
    return `Error fetching CV exist status for slug: ${slug} with error response`;
  } finally {
    processedRows++;
    console.log(`Processing ${Math.round((processedRows / totalRow) * 100)}% (${processedRows}/${totalRow})`);
  }
};

function loadTextContentByCheerio(responseData) {
  const $ = cheerio.load(responseData);
  return $('body').text().replace(/\s+/g, ' ').trim(); // ✅ Extract full text content
}

// Main function to process the Excel file
const processExcelFile = async (filePath) => {
  try {
    await fs.access(filePath); // Check if file exists
  } catch {
    console.error('File not found:', filePath);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(toCheckSheetName);

  let emailCol, phoneCol, slugCol, statusCol, cvsCol, cvsIdCol;
  const headerRow = worksheet.getRow(1);

  headerRow.eachCell((cell, colNumber) => {
    const value = cell.value.toString().toLowerCase();
    if (value.includes('email')) emailCol = colNumber;
    if (value.includes('phone')) phoneCol = colNumber;
    if (value.includes('slug')) slugCol = colNumber;
    if (value === 'cvs') cvsCol = colNumber;
    if (value.includes('cvs_id')) cvsIdCol = colNumber;
  });

  if (!emailCol || !phoneCol || !slugCol) {
    console.error('Required columns not found in the file.');
    return;
  }

  statusCol = phoneCol + 1;
  worksheet.spliceColumns(statusCol, 0, []); // Insert empty column
  worksheet.getRow(1).getCell(statusCol).value = 'Status';
  worksheet.getRow(1).getCell(statusCol).font = { bold: true }; // Make header bold

  let unUpdatedWorkSheet = workbook.addWorksheet(reportSheetName);
  unUpdatedWorkSheet.addRow(worksheet.getRow(1).values);
  let newHeaderRow = unUpdatedWorkSheet.getRow(1);
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    let newCell = newHeaderRow.getCell(colNumber);
    newCell.value = cell.value;
    newCell.font = cell.font;
    newCell.alignment = cell.alignment;
    newCell.fill = cell.fill;
    newCell.border = cell.border;
  });

  const rowsToValidate = [];

  const begin = beginRecord || 2;
  const end = endRecord || worksheet.actualRowCount;

  //Change the row number here to restrict the number of rows to be processed
  // For example for (let rowNumber = 100; rowNumber <= 200; rowNumber++) this will run the row 100 to 200 in excel file
  for (let rowNumber = begin; rowNumber <= end; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    const emailValue = row.getCell(emailCol).value ? row.getCell(emailCol).value.toString() : '';
    const phoneValue = row.getCell(phoneCol).value ? row.getCell(phoneCol).value.toString() : '';
    const slugValue = row.getCell(slugCol).value ? row.getCell(slugCol).model.value : '';

    const emailValid = isValidEmails(emailValue);
    const phoneValid = isValidPhones(phoneValue);
    row.getCell(statusCol).font = { bold: true, color: { argb: 'FF0000' } }; // Red text for errors

    if ((emailValid === true || phoneValid === true) && emailValid !== false && phoneValid !== false) {
      const slug = extractSlug(slugValue);
      if (slug) {
        rowsToValidate.push({ row, slug });
      }
    } else {
      if (emailValid === false) {
        row.getCell(statusCol).value = 'Invalid Email';
      }
      if (phoneValid === false) {
        if (emailValid === false) {
          row.getCell(statusCol).value = 'Invalid Email/Invalid Phone';
          continue;
        }
        row.getCell(statusCol).value = 'Invalid Phone';
      }
      unUpdatedWorkSheet.addRow(row.values);
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      }; // Red text for errors;
    }
  }

  // const retryRows = await loopCheckCV({rowsToValidate, statusCol, emailCol, phoneCol, workbook, unUpdatedWorkSheet})
  totalRow = rowsToValidate.length;
  await loopCheckCV({ rowsToValidate, statusCol, emailCol, phoneCol, workbook, unUpdatedWorkSheet });

  const outputFilePath = path.join(__dirname, reportFileName);
  await workbook.xlsx.writeFile(outputFilePath);
  console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

async function loopCheckCV({ rowsToValidate, statusCol, emailCol, phoneCol, workbook, unUpdatedWorkSheet }) {
  const promiseList = [];
  // const listRetryRow = [];

  const [even, odd] = [
    Math.floor(rowsToValidate.length / numberOfProcesses),
    rowsToValidate.length % numberOfProcesses,
  ];

  // Divide work among processes
  for (let i = 0; i < numberOfProcesses; i++) {
    const startIdx = i * even + Math.min(i, odd);
    const endIdx = startIdx + even + (i < odd ? 1 : 0);

    const processRows = rowsToValidate.slice(startIdx, endIdx);

    // Create a promise for each chunk
    const processPromise = checkCV({
      rowsToValidate: processRows,
      statusCol,
      emailCol,
      phoneCol,
      workbook,
      unUpdatedWorkSheet,
      // listRetryRow
    });

    promiseList.push(processPromise);
  }

  await Promise.all(promiseList);
  // return listRetryRow;
}

async function checkCV({ rowsToValidate, statusCol, emailCol, phoneCol, workbook, unUpdatedWorkSheet, listRetryRow }) {
  for (const { row, slug } of rowsToValidate) {
    const errorMessage = await checkCVExists(
      slug,
      {
        emails: getEmailsAndPhone(row.getCell(emailCol).value),
        phones: getEmailsAndPhone(row.getCell(phoneCol).value),
      },
      workbook,
      row.number,
    );
    row.getCell(statusCol).value = errorMessage;
    // if (errorMessage === RETRY_CV) {
    //     listRetryRow.push(row);
    //     continue;
    // }
    if (errorMessage) {
      unUpdatedWorkSheet.addRow(row.values);
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      };
    }
  }
}

// Run the function with the uploaded file
processExcelFile(uploadedFilePath);
