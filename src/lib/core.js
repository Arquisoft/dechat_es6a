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
	
	async setUpNewChat(userDataUrl, userWebId, interlocutorWebId, dataSync) {
    const chatUrl = await this.generateUniqueUrlForResource(userDataUrl);
    const semanticChat = new SemanticChat({
      url: chatUrl,
      messageBaseUrl: userDataUrl,
      userWebId,
      interlocutorWebId
    });
    const invitation = await this.generateInvitation(userDataUrl, semanticChat.getUrl(), userWebId, interlocutorWebId);

    try {
      await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${semanticChat.getMinimumRDF()} \n <${chatUrl}> <${namespaces.storage}storeIn> <${userDataUrl}>}`);
    } catch (e) {
      this.logger.error(`Could not save new chat data.`);
      this.logger.error(e);
    }

    try {
      await dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${chatUrl}> <${namespaces.schema}contributor> <${userWebId}>; <${namespaces.storage}storeIn> <${userDataUrl}>.}`);
    } catch (e) {
      this.logger.error(`Could not add chat to WebId.`);
      this.logger.error(e);
    }

    try {
      await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${invitation.sparqlUpdate}}`);
    } catch (e) {
      this.logger.error(`Could not save invitation for game.`);
      this.logger.error(e);
    }

    try {
      await dataSync.sendToInterlocutorInbox(await this.getInboxUrl(interlocutorWebId), invitation.notification);
    } catch (e) {
      this.logger.error(`Could not send invitation to interlocutor.`);
      this.logger.error(e);
    }

    return semanticChat;
  }
  
   async generateUniqueUrlForResource(baseurl) {
    let url = baseurl + '#' + uniqid();

    try {
      let d = this.getObjectFromPredicateForResource(url, namespaces.rdf + 'type');

      // We assume that if this url doesn't have a type, the url is unused.
      // Ok, this is not the most fail-safe thing.
      // TODO: check if there are any triples at all.
      while (d) {
        url = baseurl + '#' + uniqid();
        d = await this.getObjectFromPredicateForResource(url, namespaces.rdf + 'type');
      }
    } catch (e) {
      // this means that response of data[url] returns a 404
      // TODO might be called when you have no access, should check
    } finally {
      return url;
    }
  }
  
   async generateInvitation(baseUrl, chatUrl, userWebId, interlocutorWebId) {
    const invitationUrl = await this.generateUniqueUrlForResource(baseUrl);
    const notification = `<${invitationUrl}> a <${namespaces.schema}InviteAction>.`;
    const sparqlUpdate = `
    <${invitationUrl}> a <${namespaces.schema}InviteAction>;
      <${namespaces.schema}event> <${chatUrl}>;
      <${namespaces.schema}agent> <${userWebId}>;
      <${namespaces.schema}recipient> <${interlocutorWebId}>.
  `;

    return {
      notification,
      sparqlUpdate
    };
  }




}
module.exports = DeChatCore;
