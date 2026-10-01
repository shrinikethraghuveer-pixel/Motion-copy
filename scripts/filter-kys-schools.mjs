import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const datasets = {
  north1: {
    input: 'bengaluru_north_north1.json',
    output: 'data/institutions/kys_bengaluru_north_north1_grade6_12.json',
  },
  south1: {
    input: 'bengaluru_south_south1.json',
    output: 'data/institutions/kys_bengaluru_south_south1_grade6_12.json',
  },
};

const datasetName = process.argv[2] ?? 'north1';
const dataset = datasets[datasetName];
if (!dataset) {
  throw new RangeError(`Unknown dataset "${datasetName}". Use: ${Object.keys(datasets).join(', ')}`);
}

const inputPath = resolve(dataset.input);
const outputPath = resolve(dataset.output);

const response = JSON.parse(await readFile(inputPath, 'utf8'));
const schools = response?.data?.content;

if (!Array.isArray(schools)) {
  throw new TypeError('Expected an array at data.content in the KYS response.');
}

let missingSchoolName = 0;
let missingUdiseSchCode = 0;
let invalidOrMissingClassRange = 0;

const isValidGrade = (value) =>
  (typeof value === 'number' && Number.isInteger(value)) ||
  (typeof value === 'string' && /^\d+$/.test(value.trim()));

const toGrade = (value) => Number(value);

const records = schools.flatMap((school) => {
  if (!school.schoolName?.trim()) missingSchoolName += 1;
  if (school.udiseschCode === null || school.udiseschCode === undefined || school.udiseschCode === '') {
    missingUdiseSchCode += 1;
  }

  if (!isValidGrade(school.classFrm) || !isValidGrade(school.classTo)) {
    invalidOrMissingClassRange += 1;
    return [];
  }

  const classFrm = toGrade(school.classFrm);
  const classTo = toGrade(school.classTo);
  if (classFrm > 12 || classTo < 6) return [];

  const record = {
    name: school.schoolName,
    institution_type: 'school',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    country_code: 'IN',
    external_id: school.udiseschCode,
    aliases: [],
    source: 'UDISE+ KYS',
    is_active: mapOperationalStatus(school.schoolStatusName),
  };

  if (typeof school.website === 'string' && school.website.trim()) {
    record.website = school.website;
  }

  return [record];
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`);

console.log(`Total records in original content: ${schools.length}`);
console.log(`Number retained: ${records.length}`);
console.log(`Number excluded: ${schools.length - records.length}`);
console.log(`Number with missing schoolName: ${missingSchoolName}`);
console.log(`Number with missing udiseschCode: ${missingUdiseSchCode}`);
console.log(`Number with invalid/missing classFrm or classTo: ${invalidOrMissingClassRange}`);

function mapOperationalStatus(statusName) {
  if (statusName === 'Operational') return true;
  if (['Closed', 'Merged', 'Permanently Closed'].includes(statusName)) return false;
  return true;
}
