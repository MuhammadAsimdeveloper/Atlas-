const freeze = value => Object.freeze(value);
const clamp = (value, min=0, max=100) => Math.min(max, Math.max(min, value));

const asText = (value='') => typeof value === 'string' ? value.trim() : '';
const asList = value => Array.isArray(value) ? value.map(asText).filter(Boolean) : [];

const tokens = value => asText(value)
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .split(/\s+/)
  .filter(token => token.length > 1);

const normalizeUrl = value => {
  try {
    const parsed = new URL(asText(value));
    return parsed.toString().replace(/\/$/, '') || parsed.origin;
  } catch {
    return null;
  }
};

const containsKeyword = (textValue, keyword) => {
  const source = asText(textValue).toLowerCase();
  const term = asText(keyword).toLowerCase();
  return Boolean(term && source.includes(term));
};

const keywordCoverage = ({ title, description, h1, bodyText, focusKeywords }) => {
  const keywords = [...new Set(asList(focusKeywords).slice(0, 12))];
  if (!keywords.length) return { score: 0, assessed: false, matched: [] };
  const fields = [title, description, h1, bodyText];
  const matched = keywords.filter(keyword => fields.some(field => containsKeyword(field, keyword)));
  return {
    score: Math.round((matched.length / keywords.length) * 12),
    assessed: true,
    matched,
    missing: keywords.filter(keyword => !matched.includes(keyword)),
  };
};

export function assessSeoReadiness({
  title,
  description,
  canonicalUrl,
  robots='index,follow',
  h1,
  headings=[],
  bodyText='',
  focusKeywords=[],
  indexable=true,
  internalLinks=0,
  externalLinks=0,
  sitemapIncluded=true,
  structuredDataTypes=[],
  images=[],
  imageAltCoverage=null,
  https=null,
  mobileFriendly=null,
  coreWebVitals=null,
  uniqueContent=true,
  updatedRecently=null,
  authorOrPublisher=null,
  transparentClaims=false,
} = {}) {
  const headingList = Array.isArray(headings)
    ? headings.map(heading => typeof heading === 'object'
      ? {level:Number(heading.level), text:asText(heading.text)}
      : {level:2, text:asText(heading)}).filter(heading => heading.text)
    : [];
  const titleText = asText(title);
  const descriptionText = asText(description);
  const canonical = normalizeUrl(canonicalUrl);
  const h1Text = asText(h1);
  const imageList = Array.isArray(images) ? images : [];
  const keyword = keywordCoverage({title:titleText,description:descriptionText,h1:h1Text,bodyText,focusKeywords});

  const titleScore = !titleText ? 0 : titleText.length >= 30 && titleText.length <= 65 ? 10 : titleText.length <= 120 ? 7 : 3;
  const descriptionScore = !descriptionText ? 0 : descriptionText.length >= 70 && descriptionText.length <= 170 ? 8 : descriptionText.length <= 320 ? 5 : 2;
  const canonicalScore = canonical ? 5 : 0;
  const robotsScore = indexable
    ? /(^|,)\\s*index(,|$)/i.test(robots) && /(^|,)\\s*follow(,|$)/i.test(robots) ? 2 : 0
    : /noindex/i.test(robots) ? 2 : 0;

  const h1Score = !h1Text ? 0 : 6;
  const headingHierarchyOk = headingList.filter(h => h.level >= 2 && h.level <= 6).every((heading, index, list) => index === 0 || heading.level <= list[index - 1].level + 1);
  const headingScore = headingList.length === 0 ? 0 : headingHierarchyOk ? 4 : 2;
  const contentDepthScore = tokens(bodyText).length >= 300 ? 4 : tokens(bodyText).length >= 120 ? 3 : tokens(bodyText).length >= 60 ? 2 : 0;
  const uniquenessScore = uniqueContent ? 4 : 0;
  const intentScore = keyword.assessed ? keyword.score : 0;

  const internalLinkScore = Number.isFinite(internalLinks) ? (internalLinks >= 5 ? 5 : internalLinks >= 2 ? 3 : internalLinks >= 1 ? 1 : 0) : 0;
  const sitemapScore = indexable && sitemapIncluded ? 3 : !indexable ? 3 : 0;
  const externalLinkScore = Number.isFinite(externalLinks) && externalLinks >= 1 ? 2 : 0;

  const structured = [...new Set(asList(structuredDataTypes).map(value => value.toLowerCase()))];
  const structuredScore = !structured.length ? 0 : Math.min(6, structured.length * 2);
  const entityScore = authorOrPublisher ? 2 : 0;
  const transparencyScore = transparentClaims ? 2 : 0;

  const allImagesHaveAlt = imageList.length === 0
    ? imageAltCoverage === null ? true : imageAltCoverage >= 1
    : imageList.every(image => Boolean(image && asText(image.alt)));
  const altScore = imageAltCoverage !== null
    ? imageAltCoverage >= 1 ? 4 : imageAltCoverage >= 0.8 ? 3 : imageAltCoverage >= 0.5 ? 1 : 0
    : allImagesHaveAlt ? 4 : 1;

  const httpsScore = https === null ? 0 : https ? 3 : 0;
  const mobileScore = mobileFriendly === null ? 0 : mobileFriendly ? 3 : 0;
  const vitalsScore = coreWebVitals === null
    ? 0
    : coreWebVitals === true
      ? 4
      : (Number(coreWebVitals.lcpMs) <= 2500 && Number(coreWebVitals.inpMs) <= 200 && Number(coreWebVitals.cls) <= 0.1) ? 4 : 1;
  const freshnessScore = updatedRecently === null ? 0 : updatedRecently ? 2 : 0;

  const sectionScores = {
    metadata: titleScore + descriptionScore + canonicalScore + robotsScore,
    content: h1Score + headingScore + contentDepthScore + uniquenessScore + intentScore,
    discovery: internalLinkScore + sitemapScore + externalLinkScore,
    structuredData: structuredScore + entityScore + transparencyScore,
    media: altScore,
    experience: httpsScore + mobileScore + vitalsScore + freshnessScore,
  };
  const maxSectionScores = {
    metadata:25, content:30, discovery:10, structuredData:10, media:4, experience:12,
  };
  const maxScore = Object.values(maxSectionScores).reduce((sum, value) => sum + value, 0);
  const rawScore = Object.entries(sectionScores).reduce((sum, [section, value]) => sum + value, 0);
  const score = clamp(Math.round((rawScore / maxScore) * 100));

  const issues = [];
  const recommendations = [];
  if (titleScore < 10) recommendations.push('Make the title concise, descriptive and specific to the page topic.');
  if (descriptionScore < 8) recommendations.push('Write a unique, useful meta description that accurately summarizes the page.');
  if (!canonical) issues.push('Missing or invalid canonical URL.');
  if (indexable && !/index/i.test(robots)) issues.push('Indexable page has a robots policy that does not explicitly allow indexing.');
  if (!h1Text) issues.push('Missing a single clear primary heading (H1).');
  if (!headingHierarchyOk) issues.push('Heading hierarchy skips levels or is inconsistent.');
  if (keyword.assessed && keyword.missing?.length) recommendations.push('Align the page copy naturally with its intended search terms: ' + keyword.missing.join(', ') + '.');
  if (uniqueContent === false) issues.push('Content is flagged as non-unique or substantially duplicated.');
  if (indexable && !sitemapIncluded) issues.push('Indexable page is not included in the sitemap.');
  if (internalLinks < 2) recommendations.push('Add more descriptive internal links from relevant pages to improve discovery and topical relationships.');
  if (!structured.length) recommendations.push('Add accurate structured data for the entity/content type where a supported schema exists.');
  if (!allImagesHaveAlt) issues.push('One or more images lack useful alternative text.');
  if (https === false) issues.push('Page is not served over HTTPS.');
  if (mobileFriendly === false) issues.push('Page is not mobile-friendly.');
  if (coreWebVitals && vitalsScore < 4) recommendations.push('Improve Core Web Vitals, especially LCP, INP and CLS.');
  if (transparentClaims === false && authorOrPublisher) recommendations.push('Make important product, author, publisher and business claims independently verifiable on-page.');
  if (updatedRecently === false) recommendations.push('Refresh genuinely changed pages and keep sitemap lastmod values accurate.');

  const tier = score >= 90 ? 'excellent' : score >= 80 ? 'strong' : score >= 70 ? 'ready' : score >= 55 ? 'needs_work' : 'high_priority';

  return freeze({
    score,
    tier,
    maxScore:100,
    assessedSections:Object.freeze(Object.fromEntries(Object.entries(sectionScores).map(([name,value]) => [
      name,
      Object.freeze({score:Math.round((value / maxSectionScores[name]) * 100), raw:value, max:maxSectionScores[name]})
    ]))),
    keywordCoverage:Object.freeze(keyword),
    issues:Object.freeze([...issues]),
    recommendations:Object.freeze([...new Set(recommendations)]),
  });
}

export function assessSeoSite({ pages=[] } = {}) {
  if (!Array.isArray(pages)) throw new Error('SEO pages must be an array');
  const normalized = pages.map((page, index) => ({
    index,
    path:asText(page.path) || '/',
    title:asText(page.title),
    description:asText(page.description),
    canonicalUrl:page.canonicalUrl,
    indexable:page.indexable !== false,
    incomingLinks:Number.isFinite(page.incomingLinks) ? page.incomingLinks : 0,
    sitemapIncluded:page.sitemapIncluded !== false,
    ...page,
  }));
  const titleGroups = new Map();
  const descriptionGroups = new Map();
  const canonicalGroups = new Map();
  for (const page of normalized) {
    if (page.title) titleGroups.set(page.title, [...(titleGroups.get(page.title) || []), page.path]);
    if (page.description) descriptionGroups.set(page.description, [...(descriptionGroups.get(page.description) || []), page.path]);
    const canonical = normalizeUrl(page.canonicalUrl);
    if (canonical) canonicalGroups.set(canonical, [...(canonicalGroups.get(canonical) || []), page.path]);
  }

  const pageResults = normalized.map(page => assessSeoReadiness(page));
  const globalIssues = [];
  for (const [title, paths] of titleGroups) if (paths.length > 1) globalIssues.push('Duplicate title across: ' + paths.join(', ') + '.');
  for (const [description, paths] of descriptionGroups) if (paths.length > 1) globalIssues.push('Duplicate description across: ' + paths.join(', ') + '.');
  for (const [canonical, paths] of canonicalGroups) if (paths.length > 1) globalIssues.push('Multiple pages share canonical URL ' + canonical + ': ' + paths.join(', ') + '.');
  for (const page of normalized) {
    if (page.indexable && !page.sitemapIncluded) globalIssues.push('Indexable page missing from sitemap: ' + page.path + '.');
    if (page.indexable && page.incomingLinks === 0 && page.path !== '/') globalIssues.push('Indexable orphan page has no known internal links: ' + page.path + '.');
  }

  const score = pageResults.length
    ? Math.round(pageResults.reduce((sum, result) => sum + result.score, 0) / pageResults.length)
    : 0;

  return freeze({
    score,
    tier: score >= 90 ? 'excellent' : score >= 80 ? 'strong' : score >= 70 ? 'ready' : score >= 55 ? 'needs_work' : 'high_priority',
    pageCount:pageResults.length,
    indexablePages:normalized.filter(page => page.indexable).length,
    pages:Object.freeze(pageResults),
    issues:Object.freeze([...new Set(globalIssues)]),
  });
}
