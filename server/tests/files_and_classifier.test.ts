import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, openDatabase } from '../database/connection.ts';
import { runMigrations } from '../database/migrations/runner.ts';
import { setSetting } from '../database/repositories/settingsRepo.ts';
import { suggestFolderByRules } from '../files/classifier.ts';
import {
  deleteFileCompletely,
  moveFileToFolder,
  resolveSafeStoragePath,
  saveIncomingFile,
} from '../files/storage.ts';
import { searchFilesSmart } from '../files/search.ts';

describe('File Storage, Classification & Security', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-files-test-'));
    openDatabase(path.join(tmpDir, 'test.sqlite'));
    runMigrations();
    setSetting('storage_path', path.join(tmpDir, 'storage'));
  });

  after(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies Arabic lecture files into المحاضرات', () => {
    assert.equal(suggestFolderByRules('محاضرة_الأحياء_1.pdf', 'pdf'), 'المحاضرات');
    assert.equal(suggestFolderByRules('ملخص_مراجعة.docx', 'document'), 'الدراسة');
    assert.equal(suggestFolderByRules('photo.jpg', 'image'), 'الصور');
  });

  it('prevents filename collision overwrites and supports move/search/delete', () => {
    const buf1 = Buffer.from('محتوى الملف الأول', 'utf8');
    const buf2 = Buffer.from('محتوى الملف الثاني', 'utf8');

    const f1 = saveIncomingFile({
      buffer: buf1,
      originalName: 'الأحياء.txt',
      mimeType: 'text/plain',
      folderName: 'المحاضرات',
    });
    const f2 = saveIncomingFile({
      buffer: buf2,
      originalName: 'الأحياء.txt',
      mimeType: 'text/plain',
      folderName: 'المحاضرات',
    });

    assert.notEqual(f1.storage_path, f2.storage_path);
    assert.ok(f2.stored_name.includes('(1)'));
    assert.equal(fs.readFileSync(f1.storage_path, 'utf8'), 'محتوى الملف الأول');

    const found = searchFilesSmart({ query: 'الأحياء', folderName: 'المحاضرات' });
    assert.equal(found.length, 2);

    const moved = moveFileToFolder(f1.id, 'الأرشيف');
    assert.equal(moved?.folder_name, 'الأرشيف');

    assert.equal(deleteFileCompletely(f1.id), true);
    assert.equal(fs.existsSync(f1.storage_path), false);
  });

  it('blocks path traversal attempts outside storage root', () => {
    assert.throws(() => resolveSafeStoragePath('../../etc/passwd'), /Path Traversal/);
  });
});
