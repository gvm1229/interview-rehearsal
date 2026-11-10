import {z} from 'zod';
import sanitizeHtml from 'sanitize-html';

export const language = z.enum(['ko', 'ja', 'en']);
export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const label = z.string().trim().min(1).max(300);
export const text = z.string().min(1).max(100_000);
export const localized = z.object({text, language});
const ruby = z.string().max(30_000).transform(value => sanitizeHtml(value, {
  allowedTags: ['ruby', 'rt', 'rp'],
  allowedAttributes: {},
}));
export const sentence = localized.extend({
  reading: localized.optional(),
  translation: localized.optional(),
  rubyHtml: ruby.optional(),
});
export const assetName = z.string().max(160)
  .refine(name => !/[\\/:*?"<>|\u0000-\u001f]/u.test(name) && !name.startsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name) &&
    /\.(?:pdf|png|jpe?g|webp)$/i.test(name), '지원하지 않는 첨부 이름');

export function safeHtml(value) {
  return sanitizeHtml(value, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'details', 'summary', 'ruby', 'rt', 'rp', 'section'],
    allowedAttributes: {'*': ['class', 'id', 'lang', 'data-line'], a: ['href', 'title', 'data-asset'], details: ['open']},
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        if (!/^(https?:\/\/|#|asset:)/i.test(href)) delete attribs.href;
        if (href.startsWith('asset:')) {
          try {
            const name = assetName.parse(decodeURIComponent(href.slice(6)));
            return {tagName, attribs: {...attribs, href: '#', 'data-asset': name}};
          } catch { delete attribs.href; }
        }
        if (href === '#' && !attribs['data-asset']) delete attribs.href;
        if (!assetName.safeParse(attribs['data-asset']).success) delete attribs['data-asset'];
        return {tagName, attribs};
      },
    },
  });
}

const block = z.lazy(() => z.discriminatedUnion('type', [
  z.object({type: z.literal('html'), html: z.string().max(1_000_000).transform(safeHtml)}),
  z.object({type: z.literal('question'), questionId: id}),
  z.object({type: z.literal('group'), title: label, anchor: id.optional(), blocks: z.array(block).max(500)}),
]));
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  interviewId: z.uuid(),
  title: label,
  company: z.string().max(300),
  role: z.string().max(300),
  questionLanguage: language,
  explanationLanguage: language,
  speakingNotes: z.string().max(10_000).default(''),
});
export const settingsSchema = manifestSchema.omit({schemaVersion: true, interviewId: true});
export const questionInput = z.object({
  id, sectionId: id, title: label, prompt: localized,
  promptStudy: sentence.optional(),
  answer: z.array(sentence).max(200),
  referenceFacts: z.array(text).max(100),
  status: z.enum(['ready', 'needs_confirmation', 'archived']),
  parentId: id.optional(),
});
export const contentSchema = z.object({
  version: z.int().positive(),
  lastEdit: z.string().optional(),
  categories: z.array(z.object({id, title: label})).max(100),
  sections: z.array(z.object({
    id, title: label, categoryId: id, blocks: z.array(block).max(500),
    aliases: z.array(label).max(100).default([]),
  })).max(500),
  questions: z.array(questionInput.extend({version: z.int().positive()})).max(1000),
}).superRefine((data, ctx) => {
  const report = message => ctx.addIssue({code: 'custom', message});
  const unique = (items, key) => {
    const map = new Map(items.map(item => [item.id, item]));
    if (map.size !== items.length) report(key + ' 식별자 중복');
    return map;
  };
  const categories = unique(data.categories, '분류');
  const sections = unique(data.sections, '자료');
  const questions = unique(data.questions, '질문');
  const references = new Set();
  function visit(blocks, sectionId, depth) {
    if (depth > 12) return report('문서 묶음 단계 초과');
    for (const item of blocks) {
      if (item.type === 'group') visit(item.blocks, sectionId, depth + 1);
      if (item.type === 'question') {
        if (references.has(item.questionId)) report('질문 참조 중복');
        references.add(item.questionId);
        if (questions.get(item.questionId)?.sectionId !== sectionId) report('잘못된 질문 참조');
      }
    }
  }
  for (const section of data.sections) {
    if (!categories.has(section.categoryId)) report('자료의 분류 없음');
    visit(section.blocks, section.id, 0);
  }
  for (const q of data.questions) {
    if (!sections.has(q.sectionId)) report('질문의 자료 없음');
    if (!references.has(q.id) && q.status !== 'archived') report('질문 표시 위치 없음');
    if (q.status === 'ready' && !q.answer.length) report('준비된 질문의 답안 필요');
    if (q.promptStudy && (q.promptStudy.text !== q.prompt.text || q.promptStudy.language !== q.prompt.language)) report('질문 학습 표기와 원문 불일치');
    const seen = new Set([q.id]);
    let parent = q.parentId;
    while (parent) {
      if (seen.has(parent)) { report('후속 질문 순환 참조'); break; }
      seen.add(parent);
      const node = questions.get(parent);
      if (!node || node.sectionId !== q.sectionId) { report('후속 질문의 상위 질문 없음'); break; }
      parent = node.parentId;
    }
  }
});

export const emptyContent = () => ({version: 1, categories: [], sections: [], questions: []});
export const normalize = value => value.normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 96))
  .replace(/[^\p{L}\p{N}]/gu, '');

function words(value) {
  return value.split(/\s+/u).map(normalize).filter(Boolean);
}

export function matchesQuery(value, query) {
  const normalized = normalize(value);
  return words(query).every(word => normalized.includes(word));
}

export function questionText(q) {
  return [q.title, q.prompt.text, q.promptStudy?.reading?.text, q.promptStudy?.translation?.text,
    ...q.answer.flatMap(s => [s.text, s.reading?.text, s.translation?.text, s.rubyHtml?.replace(/<[^>]*>/g, '')]),
    ...q.referenceFacts].filter(Boolean).join(' ');
}

