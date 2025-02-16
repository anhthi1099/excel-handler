import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import { FORBIDDEN, SERVER_ERROR, ResponseType, RETRY_CV } from './constant.mjs';
import { refreshAuthToken, getAuth } from './utils/auth.mjs';
import { extractTextFromImage, extractUrlProfile } from './utils/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authInfo = getAuth();

const startRecord = 1601;
const endRecord = 0;

const numberOfProcesses = 5;

let processedRows = 0;
let totalRow = 0;

const uploadedFilePath = './social_files/[Under Testing] _ Missing_socials urls.xlsx';
let toCheckSheetName = 'To_migrate';

let reportFileName = './social_files/Social_link_report_2.xlsx';
let reportSheetName = 'To_migrate_report';

const isStrictValidate = false;

const getSocialLink = (stringValue) => {
  if (!stringValue || stringValue === '[]') return null;
  return stringValue
    .replace(/[\[\]'"]/g, '')
    .split(',')
    .map((email) => email.trim())[0];
};

// Function to validate email(s)
function isValidSocialLink(rawLink) {
  const socialLink = getSocialLink(rawLink);
  if (socialLink === null) {
    return null;
  }
  return !!extractUrlProfile(socialLink);
}

// Function to validate phone numbers
const isValidPhones = (phoneString) => {
  const phones = getSocialLink(phoneString);
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
const extractSlug = (slugString) => {
  if (!slugString) return null;
  return slugString.split('/').pop();
};

function isSameSocialLink(socialLink, extractedUrl) {
  return socialLink.replace(/\/$/, '') === extractedUrl.replace(/\/$/, '');
}

// Function to check if the profile CV exists
const checkUrlProfile = async (
  slug,
  { socialLink },
  rowNumber,
  socialCol,
  extractedUrlCol,
  unUpdatedWorkSheet,
  worksheet,
  statusCol,
) => {
  console.log('checking URL', socialLink);
  console.log('checking slug', slug);
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

    let extractedURL = undefined;
    let textContent = await loadTextContentByCheerio(responseData);
    let extractedUrlFromImg = undefined;

    if (textContent.length && textContent.includes('File Is Corrupted')) {
      return ResponseType.FILE_IS_CORRUPTED;
    }
    if (response.status === 524) {
      return ResponseType.SERVER_TIMEOUT;
    }
    if (!textContent) {
      return ResponseType.EMPTY_RESPONSE;
    }

    extractedURL = extractUrlProfile(textContent);

    if (extractedURL && isValidSocialLink(extractedURL) && isSameSocialLink(socialLink, extractedURL)) {
      return '';
    }

    const rawStringFromImg = await loadTextFromImg(responseData);
    extractedUrlFromImg = extractUrlProfile(rawStringFromImg);

    if (
      extractedUrlFromImg &&
      isValidSocialLink(extractedUrlFromImg) &&
      !isSameSocialLink(socialLink, extractedUrlFromImg)
    ) {
      worksheet.getRow(rowNumber).getCell(extractedUrlCol).value = extractedUrlFromImg;
      worksheet.getRow(rowNumber).getCell(statusCol).value = ResponseType.WRONG_URL;
      unUpdatedWorkSheet.addRow(worksheet.getRow(rowNumber).values);
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      };
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(extractedUrlCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      };

      return ResponseType.WRONG_URL;
    }

    if (extractedURL && isValidSocialLink(extractedURL) && !isValidSocialLink(extractedURL)) {
      worksheet.getRow(rowNumber).getCell(extractedUrlCol).value = extractedURL;
      worksheet.getRow(rowNumber).getCell(statusCol).value = ResponseType.WRONG_URL;
      unUpdatedWorkSheet.addRow(worksheet.getRow(rowNumber).values);
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      };
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(extractedUrlCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      };

      return ResponseType.WRONG_URL;
    }

    if (!isValidSocialLink(socialLink)) {
      return ResponseType.INVALID_URL;
    }

    console.log('Successful checked CV for slug: ', slug);
    console.log('Processing row: ', rowNumber);

    // await new Promise(resolve => setTimeout(resolve, delay));
    return errorMessage;
  } catch (error) {
    if (error.status === FORBIDDEN) {
      await refreshAuthToken();
      console.log('Refreshing Token');
      return RETRY_CV;
    }
    if (error.status === SERVER_ERROR) {
      console.log('SERVER ERROR');
      return ResponseType.SERVER_ERROR;
    }
    console.error('ERROR bug', error.status);
    console.error(`Error fetching CV exist status for slug: ${slug}`, error);
    return `Error fetching CV exist status for slug: ${slug} with error response`;
  } finally {
    processedRows++;
    console.log(`Processing ${Math.round((processedRows / totalRow) * 100)}% (${processedRows}/${totalRow})`);
  }
};

async function loadTextContentByCheerio(responseData) {
  const loadedData = await cheerio.load(responseData);
  return loadedData('body').html().replace(/\s+/g, ' ').trim(); // ✅ Extract full text content
}

async function loadTextFromImg(responseData) {
  const loadedData = cheerio.load(responseData);
  const listCVImgBase64 = loadedData('img')
    .map((i, el) => el.attribs.src)
    .get();

  const listExtractedText = await Promise.all(
    listCVImgBase64.map(async (cvImgBase64) => {
      return await extractTextFromImage(cvImgBase64);
    }),
  );

  return listExtractedText
    .flatMap(({ text }) => text)
    .join('')
    .replace(/\s+/g, '')
    .trim();
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

  let emailCol, phoneCol, slugCol, statusCol, cvsCol, cvsIdCol, socialCol, extractedUrlCol;
  const headerRow = worksheet.getRow(1);

  headerRow.eachCell((cell, colNumber) => {
    const value = cell.value.toString().toLowerCase();
    if (value.includes('email')) emailCol = colNumber;
    if (value.includes('phone')) phoneCol = colNumber;
    if (value.includes('slug')) slugCol = colNumber;
    if (value === 'cvs') cvsCol = colNumber;
    if (value.includes('cvs_id')) cvsIdCol = colNumber;
    if (value.includes('social_links')) socialCol = colNumber;
  });

  if (!emailCol || !phoneCol || !slugCol) {
    console.error('Required columns not found in the file.');
    return;
  }

  // Add cols
  statusCol = socialCol + 1;
  extractedUrlCol = statusCol + 1;
  worksheet.spliceColumns(statusCol, 0, []);
  worksheet.spliceColumns(extractedUrlCol, 0, []);
  worksheet.getRow(1).getCell(statusCol).value = 'Status';
  worksheet.getRow(1).getCell(statusCol).font = { bold: true };
  worksheet.getRow(1).getCell(extractedUrlCol).value = 'Extracted URL';
  worksheet.getRow(1).getCell(extractedUrlCol).font = { bold: true };
  // Add cols

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

  const start = startRecord || 2;
  const end = endRecord || worksheet.actualRowCount;

  for (let rowNumber = start; rowNumber <= end; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    const rawSocialString = row.getCell(socialCol).value ? row.getCell(emailCol).value.toString() : '';
    const slugValue = row.getCell(slugCol).value ? row.getCell(slugCol).model.value : '';

    let isSocialLinkValid = true;

    if (isStrictValidate) {
      isSocialLinkValid = isValidSocialLink(rawSocialString);
    }

    row.getCell(statusCol).font = { bold: true, color: { argb: 'FF0000' } }; // Red text for errors

    if (isSocialLinkValid === true && isSocialLinkValid !== false) {
      const slug = extractSlug(slugValue);
      if (slug) {
        rowsToValidate.push({ row, slug });
      }
    } else {
      if (isSocialLinkValid === false) {
        row.getCell(statusCol).value = 'Invalid URL';
      }
      unUpdatedWorkSheet.addRow(row.values);
      unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
        bold: true,
        color: { argb: 'FF0000' },
      }; // Red text for errors;
    }
  }

  totalRow = rowsToValidate.length;
  await loopCheckCV({
    rowsToValidate,
    statusCol,
    emailCol,
    phoneCol,
    workbook,
    worksheet,
    unUpdatedWorkSheet,
    socialCol,
    extractedUrlCol,
  });

  const outputFilePath = path.join(__dirname, reportFileName);
  await workbook.xlsx.writeFile(outputFilePath);
  console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

async function loopCheckCV({
  rowsToValidate,
  statusCol,
  workbook,
  unUpdatedWorkSheet,
  worksheet,
  socialCol,
  extractedUrlCol,
}) {
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
      workbook,
      unUpdatedWorkSheet,
      socialCol,
      worksheet,
      extractedUrlCol,
    });

    promiseList.push(processPromise);
  }

  await Promise.all(promiseList);
  // return listRetryRow;
}

async function checkCV({ rowsToValidate, statusCol, unUpdatedWorkSheet, socialCol, extractedUrlCol, worksheet }) {
  for (const { row, slug } of rowsToValidate) {
    const errorMessage = await checkUrlProfile(
      slug,
      {
        socialLink: getSocialLink(row.getCell(socialCol).text),
      },
      row.number,
      socialCol,
      extractedUrlCol,
      unUpdatedWorkSheet,
      worksheet,
      statusCol,
    );
    row.getCell(statusCol).value = errorMessage;
    // if (errorMessage === RETRY_CV) {
    //     listRetryRow.push(row);
    //     continue;
    // }
    if (errorMessage && errorMessage !== ResponseType.WRONG_URL) {
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
