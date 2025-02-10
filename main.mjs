import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs/promises';
import {FORBIDDEN} from "./constant.mjs";

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadedFilePath = "./migration_merged4.xlsx";


// Function to validate email(s)
const isValidEmails = (emailString) => {
    if (!emailString || emailString === '[]') return null;
    const emails = emailString.replace(/[\[\]']/g, '').split(',').map(email => email.trim());
    return emails.every(email => validator.isEmail(email));
};

// Function to validate phone numbers
const isValidPhones = (phoneString) => {
    if (!phoneString || phoneString === '[]') return null;
    const phones = phoneString.replace(/[\[\]']/g, '').split(',').map(phone => phone.trim());
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
const checkCVExists = async (slug, {cvId, email, phone}, excelFileObject, rowNumber) => {
    console.log('calling api')
    try {
        let errorMessage = '';
        const url = `https://dev-recruiter.brightsource.com/api/profiles/${slug}/cv-for-edit`;
        const response = await axios.post(url, null, {
            headers: {
                Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjhkMjUwZDIyYTkzODVmYzQ4NDJhYTU2YWJhZjUzZmU5NDcxNmVjNTQiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiRXlhbCBTb2xvbW9uIiwiaXNzIjoiaHR0cHM6Ly9zZWN1cmV0b2tlbi5nb29nbGUuY29tL2JyaWdodHNvdXJjZS1wcm9kIiwiYXVkIjoiYnJpZ2h0c291cmNlLXByb2QiLCJhdXRoX3RpbWUiOjE3Mzg4MzkwMjMsInVzZXJfaWQiOiJsYm01bkFiNWJEVnB3b25pczFGc1BZY0p2a3gyIiwic3ViIjoibGJtNW5BYjViRFZwd29uaXMxRnNQWWNKdmt4MiIsImlhdCI6MTczOTE1NzI1MCwiZXhwIjoxNzM5MTYwODUwLCJlbWFpbCI6ImV5YWxAZXRob3NpYS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiZmlyZWJhc2UiOnsiaWRlbnRpdGllcyI6eyJlbWFpbCI6WyJleWFsQGV0aG9zaWEuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.o2hhMlOpT69D1RWWvgszljl-a3iUFWgYwGYPCT9pEI1C8wnNky8EAQ-5--g4-0npDATyJ2c55IuxeZp-kyfWQq2qVCuuKLSuN3AibnLzPPFUhDoV0sbNxLMH7FNacCYD5It4w6yUqW6SktAlUOhKntLrYt5Gy-yuZsipuhACTR8yl5SuGel4LSWNBWlXLaBryvoMuUvxGMar0UjqMQBSc_7ZnRlhTvAiTIjfQ1e1mPl1HB3OEi7-XxkotywkQqLporQqzbVOYSIquemLC2BQiGweQ_2efIjxxmq8-uAQysHjso3sS_uj_2HjMq0oxtG5mV1vdFJsWmPbj-EBU4-COg'
            }
        });
        const responseData = response.data.data.data;
        console.log('response')
        console.dir(responseData, {depth: null, colors: true})
        if (responseData.includes('File Is Corrupted')) {
            return 'File Is Corrupted';
        }
        if (!responseData.includes(email)) {
            errorMessage = 'Wrong Email ';
        }
        if (!responseData.includes(phone.slice(-6))) {
            errorMessage += 'Wrong Phone';
        }
        // await new Promise(resolve => setTimeout(resolve, delay));
        return errorMessage;
    } catch (error) {
        if (error.status === FORBIDDEN) {
            const outputFilePath = path.join(__dirname, "Validated_" + path.basename(uploadedFilePath));
            await excelFileObject.xlsx.writeFile(outputFilePath);
            console.log('Processing Row: ', rowNumber)
            console.log('terminating the process')
            process.exit();
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

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber++) {
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

    for (const {row, slug} of rowsToValidate) {
        const errorMessage = await checkCVExists(slug, row.getCell(cvsIdCol).value, workbook, row.number);
        row.getCell(statusCol).value = errorMessage;
        if (errorMessage) {
            unUpdatedWorkSheet.addRow(row.values);
            unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
                bold: true,
                color: {argb: 'FF0000'}
            };
        }
    }

    const outputFilePath = path.join(__dirname, "Validated_" + path.basename(filePath));
    await workbook.xlsx.writeFile(outputFilePath);
    console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

// Run the function with the uploaded file
processExcelFile(uploadedFilePath);
