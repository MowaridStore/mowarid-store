import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function policyHtml(source: string): string {
  // Pasted prose sometimes includes spaces inside bold markers. Keep the saved text intact.
  const markdown = source
    .replace(/^[\u200B-\u200F\uFEFF]+/u, '')
    .replace(/\*\*([^\n*]+)\*\*/g, (_, text: string) => '**' + text.trim() + '**');
  return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true, breaks: true }), {
    allowedTags: [
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'strong',
      'em',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'code',
      'pre',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      a: (_tag, attributes) => ({
        tagName: 'a',
        attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'a' || !frame.attribs.href) return false;
      try {
        const url = new URL(frame.attribs.href, 'https://store.example');
        return !!url.username || !!url.password;
      } catch {
        return true;
      }
    },
  });
}
