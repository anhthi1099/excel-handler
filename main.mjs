import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs/promises';
import {FORBIDDEN, SERVER_ERROR, ResponseType} from "./constant.mjs";

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadedFilePath = "./migration_merged4.xlsx";
const credential = 'testrec@brightsource.com/12qwaszx'
const authToken = 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjhkMjUwZDIyYTkzODVmYzQ4NDJhYTU2YWJhZjUzZmU5NDcxNmVjNTQiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiRXlhbCBTb2xvbW9uIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2JyaWdodHNvdXJjZS1wcm9kIiwiYXVkIjoiYnJpZ2h0c291cmNlLXByb2QiLCJhdXRoX3RpbWUiOjE3MzkyOTg0OTcsInVzZXJfaWQiOiJsYm01bkFiNWJEVnB3b25pczFGc1BZY0p2a3gyIiwic3ViIjoibGJtNW5BYjViRFZwd29uaXMxRnNQWWNKdmt4MiIsImlhdCI6MTczOTMwMjA2OCwiZXhwIjoxNzM5MzA1NjY4LCJlbWFpbCI6ImV5YWxAZXRob3NpYS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJlbWFpbCI6WyJleWFsQGV0aG9zaWEuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.fYyAlHr5dJjYzNPgsObROLcLIlixpD5EUQE3TGKWh-B2zXCiO5jVoea2Ti-D7FOq7Of6lpvlM2BGLXirn2LkBdAtxEsJcFw9oWKmY7s8t-K4MeQcuRSmvAL2BBDjsl3HWg0Rb-pPpAuliDAn6m-YXRATAZ2dTtOXbrO2zeARmCNEdn1CKJROoHcN6fl1uTgPEIBV4O7KwDYGl5gGW6m-z3ZjWsLIOblxNTm5gMvRxWcL2T3DK7IzmLVcOMjsOMnc2TzOtaL4X77kZccRhqP1YIDgxArjOe6c_B0Jf1U4Z_T5GodsmZo0hzkLh9HhxAs3glKR8NfaLlTGb6QxnZ-sjQ'
const beginRecord = 10001;
const endRecord = 0;
const numberOfProcesses = 50;

const getEmailsAndPhone = (stringValue) => {
    if (!stringValue || stringValue === '[]') return null;
    return stringValue.replace(/[\[\]']/g, '').split(',').map(email => email.trim());
}

// Function to validate email(s)
const isValidEmails = (emailString) => {
    const emails = getEmailsAndPhone(emailString);
    if (emails === null) {
        return null;
    }
    return emails.every(email => validator.isEmail(email));
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
const extractSlug = (slugString) => {
    if (!slugString) return null;
    return slugString.split('/').pop();
};

function login() {
    const username = ''
}

// Function to check if the profile CV exists
const checkCVExists = async (slug, {emails, phones}, excelFileObject, rowNumber) => {
    console.log('emails', emails)
    console.log('phones', phones)
    console.log('calling api')
    try {
        let errorMessage = '';
        const url = `https://employer.brightsource.com/api/profiles/${slug}/cv-for-edit`;
        const response = await axios.post(url, null, {
            headers: {
                Authorization: authToken,
            }
        });
        const responseData = response.data.data.data;
        // console.log('response')
        // console.dir(responseData, {depth: null, colors: true})
        if (!responseData) {
            return ResponseType.EMPTY_RESPONSE;
        }
        if (responseData.includes('File Is Corrupted')) {
            return ResponseType.FILE_IS_CORRUPTED;
        }
        if (emails && emails.some(email => !responseData.toLowerCase().includes(email.toLowerCase()))) {
            errorMessage = ResponseType.WRONG_EMAIL;
        }
        if (phones && phones.some(phone => !responseData.includes(phone.slice(-4)))) {
            errorMessage += ResponseType.WRONG_PHONE;
        }
        // await new Promise(resolve => setTimeout(resolve, delay));
        return errorMessage;
    } catch (error) {
        if (error.status === FORBIDDEN) {
            const outputFilePath = path.join(__dirname, "Validated_" + path.basename(uploadedFilePath));
            await excelFileObject.xlsx.writeFile(outputFilePath);
            console.log('Processing Row: ', rowNumber)
            console.log(ResponseType.FORBIDDEN)
            process.exit();
        }
        if (error.status === SERVER_ERROR) {
            // const outputFilePath = path.join(__dirname, "Validated_" + path.basename(uploadedFilePath));
            // await excelFileObject.xlsx.writeFile(outputFilePath);
            console.log('Processing Row: ', rowNumber)
            console.log('SERVER ERROR')
            return ResponseType.SERVER_ERROR;
            // process.exit();
        }
        console.error('ERROR bug', error.status)
        console.error(`Error fetching CV exist status for slug: ${slug}`, error);
        return `Error fetching CV exist status for slug: ${slug}`;
    }
};

// Main function to process the Excel file
const processExcelFile = async (filePath) => {
    try {
        await fs.access(filePath); // Check if file exists
    } catch {
        console.error("File not found:", filePath);
        return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];


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
        console.error("Required columns not found in the file.");
        return;
    }


    statusCol = phoneCol + 1;
    worksheet.spliceColumns(statusCol, 0, []); // Insert empty column
    worksheet.getRow(1).getCell(statusCol).value = "Status";
    worksheet.getRow(1).getCell(statusCol).font = {bold: true}; // Make header bold

    let unUpdatedWorkSheet = workbook.addWorksheet('Unupdated report')
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
    const end = endRecord || worksheet.actualRowCount

    //Change the row number here to restrict the number of rows to be processed
    // For example for (let rowNumber = 100; rowNumber <= 200; rowNumber++) this will run the row 100 to 200 in excel file
    for (let rowNumber = begin; rowNumber <= end; rowNumber++) {
        const row = worksheet.getRow(rowNumber);

        const emailValue = row.getCell(emailCol).value ? row.getCell(emailCol).value.toString() : '';
        const phoneValue = row.getCell(phoneCol).value ? row.getCell(phoneCol).value.toString() : '';
        const slugValue = row.getCell(slugCol).value ? row.getCell(slugCol).model.value : '';

        const emailValid = isValidEmails(emailValue);
        const phoneValid = isValidPhones(phoneValue);
        row.getCell(statusCol).font = {bold: true, color: {argb: 'FF0000'}}; // Red text for errors

        if ((emailValid === true || phoneValid === true) && (emailValid !== false && phoneValid !== false)) {
            const slug = extractSlug(slugValue);
            if (slug) {
                rowsToValidate.push({row, slug});
            }
        } else {
            if (emailValid === false) {
                row.getCell(statusCol).value = "Invalid Email";
            }
            if (phoneValid === false) {
                if (emailValid === false) {
                    row.getCell(statusCol).value = "Invalid Email/Invalid Phone";
                    continue;
                }
                row.getCell(statusCol).value = "Invalid Phone";
            }
            unUpdatedWorkSheet.addRow(row.values);
            unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
                bold: true,
                color: {argb: 'FF0000'}
            }; // Red text for errors;
        }
    }

    const promiseList = [];

    const [even, odd] = [Math.floor(rowsToValidate.length / numberOfProcesses), rowsToValidate.length % numberOfProcesses];

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
            unUpdatedWorkSheet
        });

        promiseList.push(processPromise);
    }

    await Promise.all(promiseList);

    const outputFilePath = path.join(__dirname, "Validated_" + path.basename(filePath));
    await workbook.xlsx.writeFile(outputFilePath);
    console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

async function checkCV({rowsToValidate, statusCol, emailCol, phoneCol, workbook, unUpdatedWorkSheet}) {
    for (const {row, slug} of rowsToValidate) {
        const errorMessage = await checkCVExists(slug, {
            emails: getEmailsAndPhone(row.getCell(emailCol).value),
            phones: getEmailsAndPhone(row.getCell(phoneCol).value)
        }, workbook, row.number);
        row.getCell(statusCol).value = errorMessage;
        if (errorMessage) {
            unUpdatedWorkSheet.addRow(row.values);
            unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
                bold: true,
                color: {argb: 'FF0000'}
            };
        }
    }
}

// Run the function with the uploaded file
processExcelFile(uploadedFilePath);
