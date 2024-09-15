export class App {
	vault: Vault;
}

export class TFile {
	path: string;
	basename: string;
	extension: string;
	stat: { ctime: number; mtime: number; size: number };
	vault: Vault;
}

export class Vault {
	files: { [key: string]: TFile } = {};
	fileMap: { [key: string]: TFile } = {};
}

export class Notice {
	constructor(message: string) {}
}
