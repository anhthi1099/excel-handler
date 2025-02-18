import * as ocr from '@paddlejs-models/ocr';
import { createCanvas, loadImage } from 'canvas';

async function base64ToCanvas(base64) {
  const img = await loadImage(base64);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Extract text from a base64 PNG image using Paddle.js OCR.
 * @param {string} base64Image - The base64 encoded PNG image.
 */
export async function extractTextFromBase64Image(base64Image) {
  try {
    // Initialize Paddle.js OCR model
    await ocr.init();

    // Convert base64 to canvas image
    const canvas = await base64ToCanvas(base64Image);

    // Perform OCR
    const result = await ocr.recognize(canvas);
    console.log('result', result);

    // Output extracted text
    console.log('Extracted Text:', result.text);
    return result.text;
  } catch (error) {
    console.error('Error extracting text:', error);
    return null;
  }
}
