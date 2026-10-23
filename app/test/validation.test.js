const test = require('node:test');
const assert = require('node:assert/strict');
const { positiveInteger, validateCategory, validateEpisode, validAudioFile } = require('../src/validation');

test('positiveInteger rejects unsafe and non-positive identifiers', () => {
  assert.equal(positiveInteger('4'), 4);
  assert.equal(positiveInteger('0'), null);
  assert.equal(positiveInteger('4.2'), null);
  assert.equal(positiveInteger('9007199254740992'), null);
});

test('category validation trims and bounds user text', () => {
  assert.deepEqual(validateCategory({ name: '  Công nghệ  ', description: '  Mô tả  ' }), {
    value: { name: 'Công nghệ', description: 'Mô tả' }
  });
  assert.ok(validateCategory({ name: ' ' }).error);
});

test('episode validation requires a title and a valid category', () => {
  assert.deepEqual(validateEpisode({ title: 'Tập mới', categoryId: '2', host: 'Mai' }), {
    value: { title: 'Tập mới', description: '', host: 'Mai', categoryId: 2 }
  });
  assert.ok(validateEpisode({ title: 'Tập mới', categoryId: 'x' }).error);
});

test('audio uploads require an allowed extension and audio MIME type', () => {
  assert.equal(validAudioFile({ originalname: 'episode.MP3', mimetype: 'audio/mpeg' }), true);
  assert.equal(validAudioFile({ originalname: 'payload.exe', mimetype: 'audio/mpeg' }), false);
  assert.equal(validAudioFile({ originalname: 'episode.mp3', mimetype: 'text/plain' }), false);
  assert.equal(validAudioFile(null), true);
});
