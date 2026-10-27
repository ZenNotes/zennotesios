import assert from 'node:assert/strict'
import test from 'node:test'
import { hiddenDrawerFolders, type DrawerFolderSource } from './drawer-folders.ts'

const dates = { daily: 'Daily Notes', weekly: 'Weekly Notes', monthly: 'Monthly Notes' }
const off = { daily: null, weekly: null, monthly: null }
const folder = (directory: string) => ({ directory })
const note = (directory: string, noteFolder = 'inbox') => ({ folder: noteFolder, directory })

function browse(source: Partial<DrawerFolderSource>): DrawerFolderSource {
  return { folders: [], databases: [], notes: [], files: [], dateDirectories: dates, ...source }
}

function hidden(source: Partial<DrawerFolderSource>): string[] {
  return [...hiddenDrawerFolders(browse(source))].sort()
}

test('the folders the Daily, Weekly and Monthly rows open are not listed again under Notes', () => {
  const source = {
    folders: ['Daily Notes', 'Weekly Notes', 'Monthly Notes', 'Projects'].map(folder),
    notes: [note('Daily Notes'), note('Weekly Notes'), note('Monthly Notes'), note('Projects')]
  }
  assert.deepEqual(hidden(source), ['Daily Notes', 'Monthly Notes', 'Weekly Notes'])
})

test('with periodic notes off, every folder is listed', () => {
  assert.equal(hiddenDrawerFolders(browse({ folders: [folder('Daily Notes')], dateDirectories: off })).size, 0)
})

test('only the kinds that are on have rows of their own, so only those folders leave the list', () => {
  const source = {
    folders: ['Daily Notes', 'Weekly Notes'].map(folder),
    dateDirectories: { ...off, daily: 'Daily Notes' }
  }
  assert.deepEqual(hidden(source), ['Daily Notes'])
})

test('a periodic folder leaves the list even when it also holds other notes, which its row still opens', () => {
  const source = { folders: [folder('Daily Notes')], notes: [note('Daily Notes'), note('Daily Notes')] }
  assert.deepEqual(hidden(source), ['Daily Notes', 'Monthly Notes', 'Weekly Notes'])
})

test('a folder holding only periodic folders goes too, rather than opening onto nothing', () => {
  const source = {
    folders: ['Journal', 'Journal/Daily', 'Journal/Weekly'].map(folder),
    notes: [note('Journal/Daily'), note('Journal/Weekly')],
    dateDirectories: { ...off, daily: 'Journal/Daily', weekly: 'Journal/Weekly' }
  }
  assert.deepEqual(hidden(source), ['Journal', 'Journal/Daily', 'Journal/Weekly'])
})

test('a folder around a periodic folder keeps its row when it holds anything else', () => {
  const periodic = { ...off, daily: 'Journal/Daily' }
  const spine = ['Journal', 'Journal/Daily'].map(folder)
  assert.deepEqual(hidden({ folders: spine, notes: [note('Journal')], dateDirectories: periodic }), ['Journal/Daily'])
  assert.deepEqual(
    hidden({ folders: [...spine, folder('Journal/Trips')], dateDirectories: periodic }),
    ['Journal/Daily']
  )
  assert.deepEqual(
    hidden({ folders: spine, files: [folder('Journal')], dateDirectories: periodic }),
    ['Journal/Daily']
  )
  assert.deepEqual(
    hidden({ folders: spine, databases: [folder('Journal/Reading.base')], dateDirectories: periodic }),
    ['Journal/Daily']
  )
})

test('content of the same name outside the notes area does not keep a folder around', () => {
  const source = {
    folders: ['Journal', 'Journal/Daily'].map(folder),
    notes: [note('Journal', 'archive'), note('Journal/Daily')],
    dateDirectories: { ...off, daily: 'Journal/Daily' }
  }
  assert.deepEqual(hidden(source), ['Journal', 'Journal/Daily'])
})

test('a folder whose name merely starts like a periodic folder is not part of it', () => {
  const source = {
    folders: ['Journal', 'Journal/Daily', 'Journal/Daily Archive'].map(folder),
    dateDirectories: { ...off, daily: 'Journal/Daily' }
  }
  assert.deepEqual(hidden(source), ['Journal/Daily'])
})
