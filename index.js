'use strict';
const isUrl = require('is-url-superb');
const got = require('got');
const isScoped = require('is-scoped');
const getRegistryUrl = require('registry-url');
const registryAuthToken = require('registry-auth-token');
const zip = require('lodash.zip');
const validate = require('validate-npm-package-name');
const organizationRegex = require('org-regex')({exact: true});
const pMap = require('p-map');

class InvalidNameError extends Error {}

const npmOrganizationUrl = 'https://www.npmjs.com/org/';

const request = async (name, options) => {
	const isOrganization = organizationRegex.test(name);
	if (isOrganization) {
		name = name.replace(/[@/]/g, '');
	}

	const isValid = validate(name);
	if (!isValid.validForNewPackages) {
		const notices = [...isValid.warnings || [], ...isValid.errors || []].map(v => `- ${v}`);
		notices.unshift(`Invalid package name: ${name}`);
		const error = new InvalidNameError(notices.join('\n'));
		error.warnings = isValid.warnings;
		error.errors = isValid.errors;
		throw error;
	}

	let registryUrl;
	const isScopedPackage = isScoped(name);
	if (isScopedPackage) {
		registryUrl = normalizeUrl(options.registryUrl || getRegistryUrl(name.split('/')[0]));
		name = name.replace(/\//g, '%2f');
	} else {
		registryUrl = normalizeUrl(options.registryUrl || getRegistryUrl());
	}

	const authInfo = registryAuthToken(registryUrl, {recursive: true});
	const headers = {};
	if (authInfo) {
		headers.authorization = `${authInfo.type} ${authInfo.token}`;
	}

	try {
		if (isOrganization) {
			await got.head(npmOrganizationUrl + name.toLowerCase(), {timeout: 10000});
		} else {
			await got.head(registryUrl + name.toLowerCase(), {timeout: 10000, headers});
		}

		return false;
	} catch (error) {
		const {statusCode} = error.response;

		if (statusCode === 404) {
			return true;
		}

		if (isScopedPackage && statusCode === 401) {
			return true;
		}

		throw error;
	}
};

// Ensure the URL always ends in a `/`
const normalizeUrl = url => url.replace(/\/$/, '') + '/';

const npmName = async (name, options = {}) => {
	if (!(typeof name === 'string' && name.length > 0)) {
		throw new Error('Package name required');
	}

	if (typeof options.registryUrl !== 'undefined' && !(typeof options.registryUrl === 'string' && isUrl(options.registryUrl))) {
		throw new Error('The `registryUrl` option must be a valid string URL');
	}

	return request(name, options);
};

module.exports = npmName;

module.exports.many = async (names, options = {}) => {
	if (!Array.isArray(names)) {
		throw new TypeError(`Expected an array of names, got ${typeof names}`);
	}

	if (typeof options.registryUrl !== 'undefined' && !(typeof options.registryUrl === 'string' && isUrl(options.registryUrl))) {
		throw new Error('The `registryUrl` option must be a valid string URL');
	}

	const result = await pMap(names, name => request(name, options), {stopOnError: false});
	return new Map(zip(names, result));
};

module.exports.InvalidNameError = InvalidNameError;
