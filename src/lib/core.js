const N3 = require('n3');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const namespaces = require('./namespaces');
const uniqid = require('uniqid');
const winston = require('winston');
const URI = require('uri-js');
const {
	format
} = require('date-fns');
const rdfjsSourceFromUrl = require('./rdfjssourcefactory').fromUrl;

class DeChatCore {

	constructor(fetch) {
		this.inboxUrls = {};
		this.fetch = fetch;
		this.alreadyCheckedResources = [];
		this.logger = winston.createLogger({
			level: 'error',
			transports: [
				new winston.transports.Console(),
			],
			format: winston.format.cli()
		});
	}

	/**
	 * This method returns a formatted name for a WebId.
	 * @param webid: the WebId for which a formatted name needs to be created.
	 * @returns {Promise<string|null>}: a promise that resolvew with the formatted name (string) or
	 * null if no name details were found.
	 */
	async getFormattedName(webid) {
		let formattedName = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'name');

		if (!formattedName) {
			formattedName = null;
			const firstname = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'givenName');
			const lastname = await this.getObjectFromPredicateForResource(webid, namespaces.foaf + 'lastName');

			if (firstname) {
				formattedName = firstname;
			}

			if (lastname) {
				if (formattedName) {
					formattedName += ' ';
				} else {
					formattedName = '';
				}

				formattedName += lastname;
			}

			if (!formattedName) {
				formattedName = webid;
			}
		} else {
			formattedName = formattedName.value;
		}

		return formattedName;
	}

	/**
	 * This method returns the object of resource via a predicate.
	 * @param url: the url of the resource.
	 * @param predicate: the predicate for which to look.
	 * @returns {Promise}: a promise that resolves with the object or null if none is found.
	 */

	async getObjectFromPredicateForResource(url, predicate) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(url, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();

			engine.query(`SELECT ?o {
    <${url}> <${predicate}> ?o.
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					result.bindingsStream.on('data', function (data) {
						data = data.toObject();

						deferred.resolve(data['?o']);
					});

					result.bindingsStream.on('end', function () {
						deferred.resolve(null);
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

	getDefaultDataUrl(webId) {
		const parsedWebId = URI.parse(webId);
		const today = format(new Date(), 'yyyyMMdd');

		return `${parsedWebId.scheme}://${parsedWebId.host}/public/dechat_${today}.ttl`;
	}

	async writePermission(url, dataSync) {
		const response = await dataSync.executeSPARQLUpdateForUser(url, 'INSERT DATA {}');
		return response.status === 200;
	}

	/**
	 * This method returns all the chats that a user can continue, based on his WebId.
	 * @param webid: the WebId of the player.
	 * @returns {Promise}: a promise that resolves to an array with objects.
	 * Each object contains the url of the chat (chatUrl) and the url where the data of the chat is store (storeUrl).
	 */
	async getChatsToContinue(webid) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(webid, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();
			const chatUrls = [];
			const promises = [];


			engine.query(`SELECT ?chat ?url {
     ?chat <${namespaces.schema}contributor> <${webid}>;
        <${namespaces.storage}storeIn> ?url.
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(result => {
					result.bindingsStream.on('data', async(data) => {
						const deferred = Q.defer();
						promises.push(deferred.promise);
						data = data.toObject();

						const realTime = await this.getObjectFromPredicateForResource(data['?chat'].value, namespaces.chess + 'isRealTime');

						if (!realTime || realTime.value !== 'true') {
							chatUrls.push({
								chatUrl: data['?chat'].value,
								storeUrl: data['?url'].value,
							});
						}

						deferred.resolve();
					});

					result.bindingsStream.on('end', function () {
						Q.all(promises).then(() => {
							deferred.resolve(chatUrls);
						});
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}




}
module.exports = DeChatCore;
