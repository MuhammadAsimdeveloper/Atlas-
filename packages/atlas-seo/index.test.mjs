import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSeoReadiness, assessSeoSite } from './index.mjs';

test('SEO readiness rewards complete, user-focused technical and content signals', () => {
  const result = assessSeoReadiness({
    title:'AI Customer Operations for Service Businesses | Atlas',
    description:'AI customer operations, service workflows and governed follow-up automation for service businesses.',
    canonicalUrl:'https://atlas.example.com/',
    h1:'AI customer operations for service businesses',
    headings:[{level:2,text:'AI agents'},{level:2,text:'Customer service automation'},{level:2,text:'Lead follow-up'}],
    bodyText:'Atlas helps service businesses organize customer conversations, lead follow-up, service operations, and AI-assisted workflows in one governed workspace. '.repeat(6),
    focusKeywords:['AI customer operations','lead follow-up automation'],
    indexable:true,
    internalLinks:6,
    externalLinks:2,
    sitemapIncluded:true,
    structuredDataTypes:['Organization','WebSite','WebPage','SoftwareApplication','FAQPage'],
    images:[{alt:'Atlas customer operations dashboard preview'}],
    https:true,
    mobileFriendly:true,
    coreWebVitals:{lcpMs:1800,inpMs:120,cls:0.04},
    updatedRecently:true,
    authorOrPublisher:'Atlas',
    transparentClaims:true,
  });
  assert.ok(result.score >= 90);
  assert.equal(result.tier,'excellent');
  assert.equal(result.issues.length,0);
});

test('SEO site assessment catches duplicates and orphan pages', () => {
  const result = assessSeoSite({
    pages:[
      {path:'/',title:'Atlas',description:'Atlas home',canonicalUrl:'https://atlas.example.com/',h1:'Atlas',bodyText:'Atlas'.repeat(100),incomingLinks:1},
      {path:'/services',title:'Atlas',description:'Atlas home',canonicalUrl:'https://atlas.example.com/',h1:'Services',bodyText:'Services '.repeat(100),incomingLinks:0},
    ],
  });
  assert.equal(result.pageCount,2);
  assert.ok(result.issues.some(issue => issue.includes('Duplicate title')));
  assert.ok(result.issues.some(issue => issue.includes('Duplicate description')));
  assert.ok(result.issues.some(issue => issue.includes('Multiple pages share canonical URL')));
  assert.ok(result.issues.some(issue => issue.includes('orphan')));
});
