import axios from 'axios';

export async function extractTextFromImage(base64ImageData) {
  try {
    const response = await axios.post('http://localhost:5000/extract_text', {
      image: base64ImageData
    });
    return response.data
  } catch (error) {
    console.error("Error extracting text:", error.response ? error.response.data : error.message);
  }
}