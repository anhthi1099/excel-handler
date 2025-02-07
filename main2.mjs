import XLSX from 'xlsx-js-style';
import validator from 'validator';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to validate email(s)
const isValidEmails = (emailString) => {
    if (!emailString) return false;
    const emails = emailString.replace(/[\[\]']/g, '').split(',').map(email => email.trim());
    return emails.every(email => validator.isEmail(email));
};

// Function to validate phone numbers
const isValidPhones = (phoneString) => {
    if (!phoneString) return false;
    const phones = phoneString.replace(/\[|\]/g, '').split(',').map(phone => phone.trim());
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
const checkCVExists = async (slug) => {
    try {
        const url = `https://dev-recruiter.brightsource.com/api/profiles/${slug}/cv-exist`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching CV exist status for slug: ${slug}`, error);
        return null;
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

    // Read the existing workbook
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert worksheet to JSON for easier manipulation
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Identify column indexes
    const headers = data[0].map(header => header.toString().toLowerCase());
    const emailCol = headers.indexOf('emails');
    const phoneCol = headers.indexOf('phones');
    const slugCol = headers.indexOf('slug');

    if (emailCol === -1 || phoneCol === -1 || slugCol === -1) {
        console.error("Required columns not found in the file.");
        return;
    }

    const rowsToValidate = [];

    // Iterate over each row (starting from the second row)
    for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
        const row = data[rowIndex];
        const emailValue = row[emailCol] ? row[emailCol].toString() : '';
        const phoneValue = row[phoneCol] ? row[phoneCol].toString() : '';
        const slugValue = row[slugCol] ? row[slugCol].toString() : '';

        const emailValid = isValidEmails(emailValue);
        const phoneValid = isValidPhones(phoneValue);

        if (!emailValid || !phoneValid) {
            // Apply yellow fill to the entire row for failed validation
            for (let colIndex = 0; colIndex < row.length; colIndex++) {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
                if (!worksheet[cellAddress]) worksheet[cellAddress] = { v: row[colIndex] };
                worksheet[cellAddress].s = {
                    fill: {
                        patternType: "solid",
                        fgColor: { rgb: "FFFF00" } // Yellow
                    }
                };
            }
        } else {
            const slug = extractSlug(slugValue);
            if (slug) {
                rowsToValidate.push({ rowIndex, slug });
            }
        }
    }

    // Call API for valid rows
    for (const { rowIndex, slug } of rowsToValidate) {
        const cvExists = await checkCVExists(slug);
        const resultCellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: slugCol + 1 });
        worksheet[resultCellAddress] = { v: cvExists ? "CV Exists" : "CV Not Found" };
    }

    // Write the updated workbook to a new file
    const outputFilePath = path.join(__dirname, "Validated_" + path.basename(filePath));
    XLSX.writeFile(workbook, outputFilePath);
    console.log(`Validation completed. Processed file saved as: ${outputFilePath}`);
};

// Run the function with the uploaded file
const uploadedFilePath = "./Documents.xlsx";
processExcelFile(uploadedFilePath);
