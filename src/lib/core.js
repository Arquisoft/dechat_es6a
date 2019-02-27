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
const SemanticChat = require('./semanticchat');

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
			await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${semanticChat.getMinimumInfo()} \n <${chatUrl}> <${namespaces.storage}storeIn> <${userDataUrl}>}`);
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
			this.logger.error(`Could not save invitation for chat.`);
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

	async getInboxUrl(webId) {
		if (!this.inboxUrls[webId]) {
			this.inboxUrls[webId] = (await this.getObjectFromPredicateForResource(webId, namespaces.ldp + 'inbox')).value;
		}

		return this.inboxUrls[webId];
	}

	async storeMessage(userDataUrl, username, userWebId, time, message, dataSync) {

		const messageUrl = await this.generateUniqueUrlForResource(userWebId);
		const sparqlUpdate = `
		<${messageUrl}> a <${namespaces.schema}Message>;
		  <${namespaces.schema}text> <${message}>.
	  `;
		//<${namespaces.schema}author> <${username}>;
		//<${namespaces.schema}dateCreated> <${time}>;


		try {
			await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${sparqlUpdate}}`);
		} catch (e) {
			this.logger.error(`Could not save new message.`);
			this.logger.error(e);
		}

	}

	//________________ J O I N _____________________//

	/**
	 * This method check an inbox for new notifications.
	 * @param inboxUrl: the url of the inbox.
	 * @returns {Promise}: a promise that resolves with an array containing the urls of all new notifications since the last time
	 * this method was called.
	 */
	async checkUserInboxForUpdates(inboxUrl) {
		const deferred = Q.defer();
		const newResources = [];
		const rdfjsSource = await rdfjsSourceFromUrl(inboxUrl, this.fetch);
		const self = this;
		const engine = newEngine();

		engine.query(`SELECT ?resource {
      ?resource a <http://www.w3.org/ns/ldp#Resource>.
    }`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				result.bindingsStream.on('data', data => {
					data = data.toObject();

					const resource = data['?resource'].value;

					if (self.alreadyCheckedResources.indexOf(resource) === -1) {
						newResources.push(resource);
						self.alreadyCheckedResources.push(resource);
					}
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(newResources);
				});
			});

		return deferred.promise;
	}

	/**
	 * This method checks for new conversations in a notification.
	 * @param semanticChat: the current semantic chat being used
	 * @param userWebId: the WebId of the current user
	 * @param fileurl: the url of file that contains the notification.
	 * @param userDataUrl: the url where the new data is stored for the chat
	 * @param dataSync: the DataSync instance used to save that to the POD
	 * @param callback: the function with as parameters the san and url of the next move that is called at the end of this method
	 * @returns {Promise<void>}
	 */
	async checkForNewChat(semanticChat = null, userWebId, fileurl, userDataUrl, dataSync, callback) {

		//TODO adapt this
		const originalConvo = await this.getOriginalHalfMove(fileurl);

		if (originalConvo) {
			let chatUrl = await this.getObjectFromPredicateForResource(originalConvo, namespaces.schema + 'subEvent');

			if (!chatUrl) {

				chatUrl = await this.getChatOfMessage(originalConvo);

				if (chatUrl) {
					console.error('DeChat: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
				}
			}

			if (chatUrl) {
				chatUrl = chatUrl.value;

				//CHANGE THIS, No existing semanticChat
				let chat = semanticChat;


				let chatStorageUrl;

				if (!chat || chat.getUrl() !== chatUrl) {
					chatStorageUrl = await this.getStorageForChat(userWebId, chatUrl);

					if (chatStorageUrl) {
						const loader = new Loader(this.fetch);

						//TODO No existing Loader
						chat = await loader.loadFromUrl(chatUrl, userWebId, chatStorageUrl);

					} else {
						this.logger.debug(`No storage location is found for chat "${chatUrl}". Ignoring notification in ${fileurl}.`);
					}
				} else {
					chatStorageUrl = userDataUrl;
				}


				//TODO: change the chat
				if (chat && chat.isOpponentsTurn() && !chat.isRealTime()) {

					//TODO
					const lastMoveUrl = chat.getLastMove();
					let nextChatUrl;
					let endschat = false;

					if (lastMoveUrl) {
						//TODO
						const r = await this.getNextHalfMoveFromUrl(fileurl, lastMoveUrl.url, chat.getUrl());
						nextChatUrl = r.move;
						endschat = r.endschat;
					} else {
						//TODO
						nextChatUrl = await this.getFirstHalfMoveFromUrl(fileurl, chat.getUrl());
					}

					//TODO: CHANGE namespaces.chess
					if (nextChatUrl) {
						this.logger.debug(nextChatUrl);
						dataSync.deleteFileForUser(fileurl);
						//TODO ???
						if (lastMoveUrl) {
							let update = `INSERT DATA {
              <${lastMoveUrl.url}> <${namespaces.chess}nextHalfMove> <${nextChatUrl}>.
            `;
							//TODO namespaces.????
							if (endschat) {
								update += `<${chat.getUrl()}> <${namespaces.chess}hasLastHalfMove> <${nextChatUrl}>.`;
							}

							update += '}';

							dataSync.executeSPARQLUpdateForUser(chatStorageUrl, update);
						} else {
							dataSync.executeSPARQLUpdateForUser(chatStorageUrl, `INSERT DATA {
              <${chat.getUrl()}> <${namespaces.chess}hasFirstHalfMove> <${nextChatUrl}>.
            }`);
						}

						if (semanticChat && chat.getUrl() === semanticchat.getUrl()) {
							let san = await this.getObjectFromPredicateForResource(nextChatUrl, namespaces.chess + 'hasSANRecord');

							if (!san) {
								san = await this.getSANRecord(nextChatUrl);

								if (san) {
									console.error('san: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
								}
							}

							if (san) {
								callback(san.value, nextChatUrl);
							} else {
								console.error(`The move with url "${nextChatUrl}" does not have a SAN record defined.`);
							}
						}
					}
				}
			} else {
				this.logger.warn(`No chat was found for the notification about the conversation "${originalConvo}". Ignoring notification in ${fileurl}.`);
				//TODO throw error
			}
		}
	}

	/**
	 * This method returns the chat to which a message belongs.
	 * @param moveUrl: the url of the move.
	 * @returns {Promise}: a promise that returns the url of the game (NamedNode) or null if none is found.
	 */
	async getChatOfMessage(moveUrl) {
		return this.getObjectFromPredicateForResource(moveUrl, namespaces.schema + 'subEvent');
	}

	/**
	 * This method returns the url of the file where to store the data of the game.
	 * @param fileurl: the url of the file in which to look for the storage details.
	 * @param gameUrl: the url of the game for which we want to the storage details.
	 * @returns {Promise<string|null>}: a promise that resolves with the url of the file or null if none is found.
	 */
	async getStorageForChat(fileurl, gameUrl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);
		const engine = newEngine();

		engine.query(`SELECT ?url {
     <${gameUrl}> <${namespaces.schema}contributor> <${fileurl}>;
        <${namespaces.storage}storeIn> ?url.
  }`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				result.bindingsStream.on('data', async function (data) {
					data = data.toObject();

					deferred.resolve(data['?url'].value);
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(null);
				});
			});

		return deferred.promise;
	}

	/**
	 * This method returns the original chat in a file.
	 * @param fileurl: the url of the file in which to look.
	 * @returns {Promise<string|null>}: a promise that resolves with the url of the move or null if none is found.
	 */
	async getOriginalHalfMove(fileurl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();

			//TODO: CHANGE THE NAMESPACES

			engine.query(`SELECT ?convo {
    OPTIONAL {?convo <${namespaces.chess}nextHalfMove> ?nextMove.}
    OPTIONAL {?chat <${namespaces.chess}hasFirstHalfMove> ?convo.}
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					result.bindingsStream.on('data', function (data) {
						data = data.toObject();

						if (data['?convo']) {
							deferred.resolve(data['?convo'].value);
						} else {
							deferred.resolve(null);
						}
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

	/**
	 * This method returns the SAN of a move.
	 * @param moveUrl: the url of the move.
	 * @returns {Promise<string|null>}: a promise that resolves with the san or null.
	 */
	async getSANRecord(moveUrl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(moveUrl, this.fetch);
		const engine = newEngine();

		engine.query(`SELECT ?san {
    <${moveUrl}> <${namespaces.chess}hasSANRecord> ?san.
  }`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				result.bindingsStream.on('data', function (data) {
					data = data.toObject();

					deferred.resolve(data['?san']);
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(null);
				});
			});

		return deferred.promise;
	}

	/**
	 * This method returns the urls of the invitation and the ofriends response.
	 * @param fileurl: the url of the file in which to look for the response.
	 * @returns {Promise<object|null>}: a promise that resolves to {invitationUrl: string, responseUrl: string},
	 * where the invitationUrl is the url of the invitation and responseUrl the url of the response.
	 * If no response is found, the promise is resolved with null.
	 */
	async getResponseToInvitation(fileurl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();

			engine.query(`SELECT * {
    ?invitation <${namespaces.schema}result> ?response.
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					result.bindingsStream.on('data', function (data) {
						data = data.toObject();

						deferred.resolve({
							invitationUrl: data['?invitation'].value,
							responseUrl: data['?response'].value,
						});
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

	/**
	 * This method checks a file and looks for the a join request.
	 * @param fileurl: the url of the file in which to look.
	 * @param userWebId: the WebId of the user looking for requests.
	 * @returns {Promise}: a promise that resolves with {opponentWebId: string, gchatrl: string, invitationUrl: string},
	 * where opponentWebId is the WebId of the player that initiated the request, gchatrl is the url of the gchat and
	 * invitationUrl is the url of the invitation.
	 * If no request was found, null is returned.
	 */
	async getJoinRequest(fileurl, userWebId) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();
			let invitationFound = false;
			const self = this;

			engine.query(`SELECT ?invitation {
    ?invitation a <${namespaces.schema}InviteAction>.
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					result.bindchatStream.on('data', async function (result) {
						invitationFound = true;
						result = rechat.toObject();
						const inchattionUrl = result['?invitation'].value;
						let chatUrl = await self.getObjectFromPredicateForResource(invitationUrl, namespaces.schema + 'event');

						if (!chatUrl) {
							chatUrl = await self.getchatFromInvitation(invitationUrl);

							if (chatUrl) {
								self.logger.info('chat: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
							}
						}

						if (!chatUrl) {
							deferred.resolve(null);
						} else {
							chatUrl = chatUrl.value;

							const types = await self.getAllObjectsFromPredicateForResource(chatUrl, namespaces.rdf + 'type');

							let i = 0;

							//TODO : check if 'dechat' is correct or not
							while (i < types.length && types[i].value !== namespaces.chess + 'dechat') {
								i++
							}

							if (i === types.length) {
								deferred.resolve(null);
							}

							const recipient = await self.getObjectFromPredicateForResource(invitationUrl, namespaces.schema + 'recipient');

							if (!recipient || recipient.value !== userWebId) {
								deferred.resolve(null);
							}

							//TODO: no loader
							const loader = new Loader(self.fetch);
							const friendWebId = await loader.findWebIdOfOpponent(chatUrl, userWebId);

							deferred.resolve({
								friendWebId,
								chatUrl,
								invitationUrl
							});
						}
					});

					result.bindingsStream.on('end', function () {
						if (!invitationFound) {
							deferred.resolve(null);
						}
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

	async getAllObjectsFromPredicateForResource(url, predicate) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(url, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();
			const objects = [];

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

						objects.push(data['?o']);
					});

					result.bindingsStream.on('end', function () {
						deferred.resolve(objects);
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

}
module.exports = DeChatCore;
