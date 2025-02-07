import ExcelJS from 'exceljs';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs/promises';

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Function to check if the profile CV exists
const checkCVExists = async (slug, {cvId, email, phone}) => {
    console.log('calling api')
    try {
        let errorMessage = '';
        const url = `https://dev-recruiter.brightsource.com/api/profiles/${slug}/cv-for-edit`;
        const response = await axios.post(url, {cvId});
        const responseData = response.data.data;
        if (!response.data.data.includes(email)) {
            errorMessage = 'Wrong Email ';
        }
        if (!responseData.includes(phone.slice(-6))) {
            errorMessage += 'Wrong Phone';
        }
        return errorMessage;
    } catch (error) {
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

    // for (const {row, slug} of rowsToValidate) {
    //     console.log('data', row.getCell(cvsIdCol).value)
    //     const errorMessage = await checkCVExists(slug, row.getCell(cvsIdCol).value);
    //     row.getCell(statusCol).value = errorMessage;
    //     if (errorMessage) {
    //         unUpdatedWorkSheet.addRow(row.values);
    //         unUpdatedWorkSheet.getRow(unUpdatedWorkSheet.actualRowCount).getCell(statusCol).font = {
    //             bold: true,
    //             color: {argb: 'FF0000'}
    //         };
    //     }
    // }

    const outputFilePath = path.join(__dirname, "Validated_" + path.basename(filePath));
    await workbook.xlsx.writeFile(outputFilePath);
    console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

// Run the function with the uploaded file
const uploadedFilePath = "./migration_merged4.xlsx";
processExcelFile(uploadedFilePath);
