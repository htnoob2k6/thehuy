const AUDIO_TYPES = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.wav'
]);

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validateCategory(input) {
  const name = cleanText(input?.name, 60);
  const description = cleanText(input?.description, 500);
  if (name.length < 2) return { error: 'Tên danh mục cần ít nhất 2 ký tự.' };
  return { value: { name, description } };
}

function validateEpisode(input) {
  const title = cleanText(input?.title, 160);
  const description = cleanText(input?.description, 5000);
  const host = cleanText(input?.host, 100);
  const categoryId = positiveInteger(input?.categoryId);
  if (title.length < 2) return { error: 'Tên tập cần ít nhất 2 ký tự.' };
  if (!categoryId) return { error: 'Vui lòng chọn danh mục hợp lệ.' };
  return { value: { title, description, host, categoryId } };
}

function validAudioFile(file) {
  if (!file) return true;
  const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
  return AUDIO_TYPES.has(extension) && file.mimetype.startsWith('audio/');
}

module.exports = { cleanText, positiveInteger, validateCategory, validateEpisode, validAudioFile };
