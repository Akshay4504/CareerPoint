const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = ['.git', 'node_modules', '.next', 'scratch', 'prisma/migrations', 'dev.log', 'server.log', 'worker.log', '.dockerignore'];

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function (file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!IGNORED_DIRS.some(ignored => file.includes(ignored))) {
        results = results.concat(walk(file));
      }
    } else {
      if (!IGNORED_DIRS.some(ignored => file.includes(ignored)) && !file.endsWith('.svg') && !file.endsWith('.png') && !file.endsWith('.ico') && !file.endsWith('.pdf')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('d:/projects/BIM_CONNECT/BIM_CONNECT');

let changed = 0;
files.forEach(file => {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;
    
    // Replace lower case careerpoint with careerpoint
    content = content.replace(/careerpoint/g, 'careerpoint');
    
    // Replace upper case CareerPoint with CareerPoint
    content = content.replace(/CareerPoint/g, 'CareerPoint');
    
    // Also BIM21x or Careerpoint if any
    content = content.replace(/Careerpoint/g, 'Careerpoint');

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Updated ${file}`);
      changed++;
    }
  } catch (e) {
    console.error(`Error reading ${file}: ${e.message}`);
  }
});

console.log(`Changed ${changed} files.`);
