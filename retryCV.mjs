import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio'; // ✅ Replace linkedom with cheerio
import fs from 'fs/promises';
import { FORBIDDEN, SERVER_ERROR, ResponseType, RETRY_CV } from './constant.mjs';

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credential = 'testrec@brightsource.com/12qwaszx';
const authToken =
  'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjhkMjUwZDIyYTkzODVmYzQ4NDJhYTU2YWJhZjUzZmU5NDcxNmVjNTQiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiRXlhbCBTb2xvbW9uIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2JyaWdodHNvdXJjZS1wcm9kIiwiYXVkIjoiYnJpZ2h0c291cmNlLXByb2QiLCJhdXRoX3RpbWUiOjE3Mzk1NTU4MjksInVzZXJfaWQiOiJsYm01bkFiNWJEVnB3b25pczFGc1BZY0p2a3gyIiwic3ViIjoibGJtNW5BYjViRFZwd29uaXMxRnNQWWNKdmt4MiIsImlhdCI6MTczOTU1NTgyOSwiZXhwIjoxNzM5NTU5NDI5LCJlbWFpbCI6ImV5YWxAZXRob3NpYS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJlbWFpbCI6WyJleWFsQGV0aG9zaWEuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.GlgtlNIdbAsvQmYc-b9GCf-jWiMckoVcG8agEJRlzexV5NKMMDXF9gKLeQ-SuDTowfzVVADKSNrPFDuImUoLB-HdxKySqu2zKNrdk5MngeYLiA1bKGBMFeVnwbG5j3yVc3_6arIX0Eg6WqNQKcGqsEO5YL-1BJIjOuaeMu85Uuo2aweND84lxYWLQVRzLZyFhaPDnv9o1iYnh3dX9jC-jp08DIwpHob0hsIzpK-oS1558Lsm4dsVo9yPXfRgBK8fpjzqHzi_kXMMrQkM9Ru7MWootHuZO9EdxOFZWTV2sk9DoaPXtxpVAFPN5P1vTn9iAnxFp4OtbVF31hxtUOzyCw';
const beginRecord = 0;
const endRecord = 0;
const numberOfProcesses = 50;

let processedRows = 0;
let totalRow = 0;
const validatedWorkSheetName = 'To be migrated_Report';
const originalWorkSheetName = 'To be migrated';
const uploadedFilePath = './Validated_migrated_Original.xlsx';
const outputFilePath = path.join(__dirname, uploadedFilePath);
const changedRowList = [];

const getEmailsAndPhone = (stringValue) => {
  if (!stringValue || stringValue === '[]') return null;
  return stringValue
    .replace(/[\[\]'"]/g, '')
    .split(',')
    .map((email) => email.trim());
};

// Function to validate email(s)
const isValidEmails = (emailString) => {
  const emails = getEmailsAndPhone(emailString);
  if (emails === null) {
    return null;
  }
  return emails.every((email) => validator.isEmail(email));
};

// Function to validate phone numbers
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

// Function to extract the last part of a URL from slug column
function extractSlug(slugString, rowNumber) {
  try {
    if (!slugString) return null;
    return slugString.split('/').pop();
  } catch (error) {
    console.error('Error extracting slug', error);
    return null;
  }
}

function checkContainReversedEmail(emailString, htmlString) {
  const [localPart, domainPart] = emailString.split('@');
  const email = `@${domainPart}${localPart}`;

  return htmlString.toLowerCase().includes(email.toLowerCase());
}

// Function to check if the profile CV exists
const checkCVExists = async (slug, { emails, phones }, excelFileObject, rowNumber, row) => {
  console.log('emails', emails);
  console.log('calling api');
  try {
    let errorMessage = '';
    const url = `https://employer.brightsource.com/api/profiles/${slug}/cv-for-edit`;
    const response = await axios.post(url, null, {
      headers: {
        Authorization: authToken,
      },
    });
    let responseData = response.data.data.data;

    if (!responseData || !responseData.length) {
      console.log('Abnormal response returned');
      return RETRY_CV;
    }

    changedRowList.push(row);

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
      await excelFileObject.xlsx.writeFile(outputFilePath);
      console.log('Processing Row: ', rowNumber);
      console.log(ResponseType.FORBIDDEN);
      process.exit();
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
  const originalWorkSheet = workbook.getWorksheet(originalWorkSheetName);
  const validatedWorkSheet = workbook.getWorksheet(validatedWorkSheetName);

  let emailCol, phoneCol, slugCol, statusCol, cvsCol, cvsIdCol;
  const headerRow = originalWorkSheet.getRow(1);

  headerRow.eachCell((cell, colNumber) => {
    const value = cell.value.toString().toLowerCase();
    if (value.includes('email')) emailCol = colNumber;
    if (value.includes('phone')) phoneCol = colNumber;
    if (value.includes('slug')) slugCol = colNumber;
    if (value === 'cvs') cvsCol = colNumber;
    if (value.includes('cvs_id')) cvsIdCol = colNumber;
    if (value.includes('status')) statusCol = colNumber;
  });

  if (!emailCol || !phoneCol || !slugCol) {
    console.error('Required columns not found in the file.');
    return;
  }

  const rowsToValidate = [];

  const begin = beginRecord || 2;
  const end = endRecord || originalWorkSheet.actualRowCount;

  //Change the row number here to restrict the number of rows to be processed
  // For example for (let rowNumber = 100; rowNumber <= 200; rowNumber++) this will run the row 100 to 200 in excel file
  for (let rowNumber = begin; rowNumber <= end; rowNumber++) {
    const row = originalWorkSheet.getRow(rowNumber);

    const statusValue = row.getCell(statusCol).value;
    if (statusValue === RETRY_CV) {
      rowsToValidate.push({ row, slug: extractSlug(row.getCell(slugCol).text, row.number) });
    }
  }

  totalRow = rowsToValidate.length;
  await loopCheckCV({ rowsToValidate, statusCol, slugCol, emailCol, phoneCol, workbook, validatedWorkSheet });
  await removePassValidationInReportFile(slugCol, statusCol, workbook, validatedWorkSheet);

  await workbook.xlsx.writeFile(outputFilePath);
  console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

async function loopCheckCV({ rowsToValidate, statusCol, slugCol, emailCol, phoneCol, workbook, validatedWorkSheet }) {
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
      slugCol,
      workbook,
      validatedWorkSheet,
      // listRetryRow
    });

    promiseList.push(processPromise);
  }

  await Promise.all(promiseList);
  // return listRetryRow;
}

async function checkCV({ rowsToValidate, statusCol, emailCol, slugCol, phoneCol, workbook, validatedWorkSheet }) {
  for (const { row, slug } of rowsToValidate) {
    row.getCell(statusCol).value = await checkCVExists(
      slug,
      {
        emails: getEmailsAndPhone(row.getCell(emailCol).value),
        phones: getEmailsAndPhone(row.getCell(phoneCol).value),
      },
      workbook,
      row.number,
      row,
    );
  }
}

async function removePassValidationInReportFile(slugCol, statusCol, workbook, validatedWorkSheet) {
  for (let i = 2; i < validatedWorkSheet.actualRowCount; i++) {
    const rowSlug = extractSlug(validatedWorkSheet.getRow(i).getCell(slugCol || 1).text);
    const rowStatus = validatedWorkSheet.getRow(i).getCell(statusCol).text;

    if (rowStatus === RETRY_CV) {
      for (let z = 0; z < changedRowList.length; z++) {
        const originalRowSlug = extractSlug(changedRowList[z].getCell(slugCol || 1).text);
        const originalRowStatus = changedRowList[z].getCell(statusCol).text;

        if (rowSlug === originalRowSlug) {
          if (originalRowStatus) {
            validatedWorkSheet.getRow(i).getCell(statusCol).value = originalRowStatus;
          } else {
            console.log('DID SPLICE ROW');
            validatedWorkSheet.spliceRows(i, 1);
          }
        }
      }
    }
  }
}

// Run the function with the uploaded file
processExcelFile(uploadedFilePath);
