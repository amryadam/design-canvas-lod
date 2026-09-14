import { mountWorkspace } from './workspace';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root application element');

mountWorkspace(root, { baseUrl: import.meta.env.BASE_URL, host: 'standalone' });
