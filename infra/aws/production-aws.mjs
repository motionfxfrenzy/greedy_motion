// Local production CLI wrapper. Credentials stay in a gitignored, mode-600 CSV.
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const path = fileURLToPath(new URL('./.env.production.csv', import.meta.url));
if ((statSync(path).mode & 0o077) !== 0) throw new Error('Production credential file must be mode 600');
const rows = readFileSync(path, 'utf8').trim().split(/\r?\n/).map(line => line.split(',').map(x => x.replace(/^"|"$/g, '').trim()));
const values = Object.fromEntries(rows[0].map((key, i) => [key, rows[1]?.[i]]));
if (!values['Access key ID'] || !values['Secret access key']) throw new Error('Unexpected AWS credential CSV format');
const env = {...process.env, AWS_ACCESS_KEY_ID: values['Access key ID'], AWS_SECRET_ACCESS_KEY: values['Secret access key'], AWS_REGION: 'ap-southeast-1', AWS_DEFAULT_REGION: 'ap-southeast-1', AWS_PAGER: ''};
delete env.AWS_SESSION_TOKEN;
delete env.AWS_PROFILE;
const result = spawnSync('aws', process.argv.slice(2), {env, stdio: 'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
