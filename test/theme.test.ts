import test from 'node:test';
import assert from 'node:assert/strict';
import { savedTheme } from '../src/lib/theme';
test('appearance defaults to night, accepts only explicit day and tolerates blocked storage',()=>{
 assert.equal(savedTheme(),'night');
 for(const value of ['night','invalid','',null])assert.equal(savedTheme({getItem:()=>value}),'night');
 assert.equal(savedTheme({getItem:()=> 'day'}),'day');
 assert.equal(savedTheme({getItem:()=>{throw new Error('Blocked storage');}}),'night');
});
