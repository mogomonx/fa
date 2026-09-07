// Prints the current results export's TSV download URL to stdout.
// Used by the GitHub Actions workflow: TSV_URL=$(node scripts/get-export-url.js)

async function main() {
  const res = await fetch('https://www.worldcubeassociation.org/api/v0/export/public');
  if (!res.ok) {
    throw new Error(`export/public returned ${res.status}`);
  }
  const data = await res.json();
  if (!data.tsv_url) {
    throw new Error(`No tsv_url in export/public response: ${JSON.stringify(data)}`);
  }
  process.stdout.write(data.tsv_url);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
