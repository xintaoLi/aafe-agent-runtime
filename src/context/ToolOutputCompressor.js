export class ToolOutputCompressor {
  constructor({ maxChars = 6000, headChars = 1800, tailChars = 3000 } = {}) { this.maxChars = maxChars; this.headChars = headChars; this.tailChars = tailChars; }
  compress(value, { artifact = null } = {}) {
    const text = String(value ?? '');
    if (text.length <= this.maxChars) return { content: text, truncated: false, originalChars: text.length, artifact };
    const errors = [...text.matchAll(/^.*(?:error|failed|exception|fatal|not permitted|denied).*$/gim)].slice(0, 20).map((match) => match[0]);
    const content = [text.slice(0, this.headChars), errors.length ? `\n[ERROR SUMMARY]\n${errors.join('\n')}` : '', `\n[... ${text.length - this.headChars - this.tailChars} chars omitted ...]\n`, text.slice(-this.tailChars)].join('');
    return { content, truncated: true, originalChars: text.length, artifact, reason: 'tool-output-budget' };
  }
}
