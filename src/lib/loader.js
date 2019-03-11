const N3 = require('n3');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const Q = require('q');
const streamify = require('streamify-array');
const namespaces = require('./namespaces');
const SemanticChat = require('./semanticchat');

/**
 * The Loader allows creating a Semantic Chess instance via information loaded from an url.
 */
class Loader {

	/**
	 * This constructor creates an instance of Loader.
	 * @param fetch: the function used to fetch the data
	 */
	constructor(fetch) {
		this.engine = newEngine();
		this.fetch = fetch;
	}

	/**
	 * This method loads the messages from the url passed through the parameter
	 */
	async loadFromUrl(chatUrl, userWebId, chatBaseUrl) {

		//const interlocutorWebId = await this.findWebIdOfInterlocutor(chatUrl, userWebId);
		//console.log(interlocutorWebId);

		const chat = new SemanticChat({
			url: chatUrl,
			chatBaseUrl,
			userWebId
			//interlocutorWebId
		});
		console.log("C");
		const messages = await this._findMessage(chatUrl);
		//console.log("friendWebId in loader.js is: " +interlocutorWebId);
		//console.log(messages);
		//console.log(messages.length);

		for (var i = 0, len = messages.length; i < len; i++) {
			chat.loadMessage(messages[i]);
		}
		return chat;
	}

	/**
	 * This method is in charge of finding the message through the message url
	 */
	async _findMessage(messageUrl) {
		const deferred = Q.defer();
		let results = [];

		const rdfjsSource = await this._getRDFjsSourceFromUrl(messageUrl);
		let nextMessageFound = false;
		this.engine.query(`SELECT * {
		?message a <${namespaces.schema}Message>;
		<${namespaces.schema}dateSent> ?time;
		<${namespaces.schema}givenName> ?username;				
		<${namespaces.schema}text> ?msgtext. }`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				result.bindingsStream.on('data', data => {
					data = data.toObject();
					if (data['?msgtext']) {
						var messageText = data['?msgtext'].value.split("/")[4];
						var author = data['?username'].value.split("/")[4];
						results.push({
							messagetext: messageText.replace(/U\+0020/g, " "),
							url: data['?message'].value,
							author: author.replace(/U\+0020/g, " "),
							time: data['?time'].value.split("/")[4]
						});
					}
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(results);
				});
			});

		return deferred.promise;
	}

	/**
	 * This method is in charge of finding the webId of the user's friend
	 */
	async findWebIdOfInterlocutor(chatUrl, userWebId) {
		const deferred = Q.defer();

		const rdfjsSource = await this._getRDFjsSourceFromUrl(chatUrl);
		console.log(chatUrl);
		console.log(userWebId);

		this.engine.query(`SELECT * {
			?rurl <${namespaces.schema}agent> ?webid.`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				console.log(result);
				result.bindingsStream.on('data', function (data) {
					console.log("SI");
					const id = data.toObject()['?webid'].value;

					if (id !== userWebId) {
						deferred.resolve(id);
					}
				});

				result.bindingsStream.on('end', function () {
					console.log("NO");
					deferred.resolve(null);
				});
			});
		console.log(deferred.promise);
		return deferred.promise;
	}

	/**
	 * This method is in charge of returning the RDFjs source from the url
	 */
	_getRDFjsSourceFromUrl(url) {
		const deferred = Q.defer();

		this.fetch(url)
			.then(async res => {
				if (res.status === 404) {
					deferred.reject(404);
				} else {
					const body = await res.text();
					const store = N3.Store();
					const parser = N3.Parser({
						baseIRI: res.url
					});

					parser.parse(body, (err, quad, prefixes) => {
						if (err) {
							deferred.reject();
						} else if (quad) {
							store.addQuad(quad);
						} else {
							const source = {
								match: function (s, p, o, g) {
									return streamify(store.getQuads(s, p, o, g));
								}
							};

							deferred.resolve(source);
						}
					});
				}
			});

		return deferred.promise;
	}

	/**
	 * This method is in charge of transforming the predicate to an object
	 */
	async _getObjectFromPredicateForResource(url, predicate) {
		const deferred = Q.defer();
		const rdfjsSource = await this._getRDFjsSourceFromUrl(url);
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

		return deferred.promise;
	}

}

module.exports = Loader;
