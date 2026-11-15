import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, openDatabase } from '../database/connection.ts';
import { runMigrations } from '../database/migrations/runner.ts';
import { listFolders, createFolder } from '../database/repositories/foldersRepo.ts';
import { upsertWhatsAppUser, deleteWhatsAppUser } from '../database/repositories/usersRepo.ts';
import { checkWhatsAppPermission } from '../auth/permissions.ts';
import { setSetting, getSetting } from '../database/repositories/settingsRepo.ts';

describe('Database Migrations & WhatsApp RBAC', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-db-test-'));
    openDatabase(path.join(tmpDir, 'test.sqlite'));
    runMigrations();
  });

  after(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds default Arabic folders and preserves custom folders across re-migrations', () => {
    const folders = listFolders();
    const names = folders.map((f) => f.name);
    assert.ok(names.includes('المحاضرات'));
    assert.ok(names.includes('الدراسة'));
    assert.ok(names.includes('المستندات'));

    createFolder('مجلد اختبار مخصص');
    // Re-running migrations must NOT wipe data
    runMigrations();
    const afterNames = listFolders().map((f) => f.name);
    assert.ok(afterNames.includes('مجلد اختبار مخصص'));
  });

  it('enforces RBAC strictly by normalized E.164 phone number', () => {
    const added = upsertWhatsAppUser({
      phone: '00249912345678',
      displayName: 'طالب مصرح له',
      role: 'authorized',
    });
    assert.equal(added.phone_e164, '+249912345678');

    const authCheck = checkWhatsAppPermission('249912345678@c.us', 'authorized');
    assert.equal(authCheck.allowed, true);
    assert.equal(authCheck.role, 'authorized');

    const adminCheck = checkWhatsAppPermission('+249912345678', 'admin');
    assert.equal(adminCheck.allowed, false);

    const unknownCheck = checkWhatsAppPermission('+249999999999', 'authorized');
    assert.equal(unknownCheck.allowed, false);
    assert.equal(unknownCheck.role, 'unauthorized');

    assert.equal(deleteWhatsAppUser(added.id), true);
  });

  it('persists configurable settings in SQLite', () => {
    setSetting('timezone', 'Africa/Khartoum');
    assert.equal(getSetting('timezone'), 'Africa/Khartoum');
  });
});
