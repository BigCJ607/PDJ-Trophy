import http from 'http';

async function verify() {
  console.log('Verifying projector.html and styles.css for TN and transition logic...');

  // Check projector.html does not contain hardcoded TN
  const fs = await import('fs');
  const projHtml = fs.readFileSync('projector.html', 'utf-8');
  if (projHtml.includes('>TN<')) {
    throw new Error('projector.html still has hardcoded >TN<');
  }
  console.log('✓ projector.html has no hardcoded TN initials');

  // Check styles.css has .hidden
  const css = fs.readFileSync('styles.css', 'utf-8');
  if (!css.includes('.hidden') || !css.includes('display: none !important')) {
    throw new Error('styles.css missing .hidden display: none !important rule');
  }
  console.log('✓ styles.css has global .hidden { display: none !important; }');

  // Check projector.js does not have the persistent status === "SOLD" loop
  const projJs = fs.readFileSync('projector.js', 'utf-8');
  if (projJs.includes("else if (status === 'SOLD')") && projJs.includes("applySoldOverlay(pName")) {
    throw new Error('projector.js still has persistent else if (status === "SOLD") applySoldOverlay block');
  }
  console.log('✓ projector.js persistent sold overlay loop removed');

  console.log('✅ ALL VERIFICATIONS PASSED!');
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});
