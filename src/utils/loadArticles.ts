import fs from 'fs';
import path from 'path';

export function getLatestArticles() {
  const filePath = path.resolve('public/latest_articles.json');
  const json = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(json);
}
