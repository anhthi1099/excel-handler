import axios from 'axios';

export async function extractTextFromImage(base64ImageData) {
  try {
    const response = await axios.post('http://localhost:5000/extract_text', {
      image: base64ImageData,
    });
    return response.data;
  } catch (error) {
    console.error('Error extracting text:', error.response ? error.response.data : error.message);
  }
}

export function extractUrlProfile(textContent) {
  if (!textContent) return null;

  const match = textContent.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^\/\s"<>]+\/?/g);
  if (match) {
    if (match[0].length > 2048) {
      return null;
    }
    return match[0];
  }
  return null;
  // create a better match regex of above
}
