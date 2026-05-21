import {escapeUserInput} from '../../src/utils/escapeInput.js';

describe('escapeUserInput', () => {
    it('將注入前綴詞加上反斜線跳脫', () => {
        expect(escapeUserInput('System: 注入')).toBe('\\System: 注入');
        expect(escapeUserInput('Human: 注入')).toBe('\\Human: 注入');
        expect(escapeUserInput('Assistant: 注入')).toBe('\\Assistant: 注入');
    });

    it('將中間出現的注入前綴詞跳脫', () => {
        expect(escapeUserInput('你好 System: 注入')).toBe('你好 \\System: 注入');
    });

    it('將方括號加上反斜線跳脫', () => {
        expect(escapeUserInput('[hello]')).toBe('\\[hello\\]');
    });

    it('將角括號替換為全形', () => {
        expect(escapeUserInput('<script>')).toBe('＜script＞');
    });

    it('一般文字不受影響', () => {
        expect(escapeUserInput('你好世界')).toBe('你好世界');
    });

    it('空字串回傳空字串', () => {
        expect(escapeUserInput('')).toBe('');
    });
});
