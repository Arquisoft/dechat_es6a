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
const Loader = require('./loader');

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
		const today = format(new Date(), 'yyyyMMddhhmm');

		return `${parsedWebId.scheme}://${parsedWebId.host}/private/dechat_${today}.ttl`;
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
	async getChatsToOpen(webid) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(webid, this.fetch);

		if (rdfjsSource) {
			const engine = newEngine();
			const chatUrls = [];
			const promises = [];

			engine.query(`SELECT ?chat ?int ?url {
			 ?chat <${namespaces.schema}contributor> <${webid}>;
				<${namespaces.schema}recipient> ?int;
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
						chatUrls.push({
							chatUrl: data['?chat'].value,
							storeUrl: data['?url'].value,
							interlocutor: data['?int'].value
						});
						deferred.resolve();
					});

					result.bindingsStream.on('end', function () {
						Q.all(promises).then(() => {
							//console.log(chatUrls);
							deferred.resolve(chatUrls);
						});
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

	/**
	 * This method creates a new chat
	 */
	async setUpNewChat(userDataUrl, userWebId, interlocutorWebId, dataSync) {
		const chatUrl = await this.generateUniqueUrlForResource(userDataUrl);
		const semanticChat = new SemanticChat({
			url: chatUrl,
			messageBaseUrl: userDataUrl,
			userWebId,
			interlocutorWebId
		});
		const invitation = await this.generateInvitation(userDataUrl.replace("/private/", "/public/"), semanticChat.getUrl(), userWebId, interlocutorWebId);
		const invitation2 = await this.generateInvitation(userDataUrl, semanticChat.getUrl(), userWebId, interlocutorWebId);

		try {
			await dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${chatUrl}> <${namespaces.schema}contributor> <${userWebId}>; 
			<${namespaces.schema}recipient> <${interlocutorWebId}>;
			<${namespaces.storage}storeIn> <${userDataUrl}>.}`);
		} catch (e) {
			this.logger.error(`Could not add chat to WebId.`);
			this.logger.error(e);
		}

		try {
			await dataSync.executeSPARQLUpdateForUser(userDataUrl.replace("/private/", "/public/"), `INSERT DATA {${invitation.sparqlUpdate}}`);

			await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${invitation2.sparqlUpdate}}`);
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
		//console.log(invitationUrl);
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
		//console.log(this.alreadyCheckedResources);

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
					//console.log(resource);
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
	 * This method returns the chat to which a message belongs.
	 * @param moveUrl: the url of the move.
	 * @returns {Promise}: a promise that returns the url of the chat (NamedNode) or null if none is found.
	 */
	async getChatOfMessage(moveUrl) {
		return this.getObjectFromPredicateForResource(moveUrl, namespaces.schema + 'subEvent');
	}

	/**
	 * This method returns the url of the file where to store the data of the chat.
	 * @param fileurl: the url of the file in which to look for the storage details.
	 * @param chatUrl: the url of the chat for which we want to the storage details.
	 * @returns {Promise<string|null>}: a promise that resolves with the url of the file or null if none is found.
	 */
	async getStorageForChat(fileurl, chatUrl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);
		const engine = newEngine();

		engine.query(`SELECT ?url {
     <${chatUrl}> <${namespaces.schema}contributor> <${fileurl}>;
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
			console.log("Alli?");
		}

		return deferred.promise;
	}

	/**
	 * This method checks a file and looks for the a join request.
	 * @param fileurl: the url of the file in which to look.
	 * @param userWebId: the WebId of the user looking for requests.
	 * @returns {Promise}: a promise that resolves with {interlocutorWebId: string, gchatrl: string, invitationUrl: string},
	 * where interlocutorWebId is the WebId of the player that initiated the request, gchatrl is the url of the gchat and
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
					result.bindingsStream.on('data', async function (result) {

						invitationFound = true;
						result = result.toObject();
						//console.log(result);
						const invitationUrl = result['?invitation'].value;
						let chatUrl = invitationUrl.split("#")[0];
						if (!chatUrl) {
							chatUrl = await self.getChatFromInvitation(invitationUrl);

							if (chatUrl) {
								self.logger.info('chat: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
							}
						}
						//console.log(chatUrl);

						if (!chatUrl) {
							deferred.resolve(null);
						} else {
							//console.log(invitationUrl);
							const recipient = await self.getObjectFromPredicateForResource(invitationUrl, namespaces.schema + 'recipient');
							//console.log("Recipient: " + recipient);
							if (!recipient || recipient.value !== userWebId) {
								deferred.resolve(null);
							}

							const friendWebId = await self.getObjectFromPredicateForResource(invitationUrl, namespaces.schema + 'agent');
							//console.log("Agent: " + friendWebId);

							deferred.resolve({
								friendWebId,
								chatUrl,
								invitationUrl
							});
						}
					});

					result.bindingsStream.on('end', function () {
						if (!invitationFound) {
							console.log("NO");
							deferred.resolve(null);
						}
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

	async getInterlocutor(fileurl, userWebId) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);
		//console.log(fileurl);

		if (rdfjsSource) {
			const engine = newEngine();
			let invitationFound = false;
			const self = this;

			engine.query(`SELECT * {
		?invitation a <${namespaces.schema}InviteAction>;
	<${namespaces.schema}agent> ?sender;
	<${namespaces.schema}event> ?chaturl; 
	<${namespaces.schema}recipient> ?interlocutor. 
  }`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					console.log(result);
					result.bindingsStream.on('data', async function (result) {

						invitationFound = true;
						result = result.toObject();

						deferred.resolve(
							result['?interlocutor'].value
						);
					});

					result.bindingsStream.on('end', function () {
						if (!invitationFound) {
							console.log("NO");
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

	async joinExistingChat(invitationUrl, interlocutorWebId, userWebId, userDataUrl, dataSync, fileUrl) {

		const response = await this.generateResponseToInvitation(userDataUrl, invitationUrl, userWebId, interlocutorWebId, "yes");

		dataSync.sendToInterlocutorInbox(await this.getInboxUrl(interlocutorWebId), response.notification);

		const chatUrl = await this.generateUniqueUrlForResource(userDataUrl);

		try {
			await dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${chatUrl}> <${namespaces.schema}contributor> <${userWebId}>; 
			<${namespaces.schema}recipient> <${interlocutorWebId}>;
			<${namespaces.storage}storeIn> <${userDataUrl}>.}`);
		} catch (e) {
			this.logger.error(`Could not add chat to WebId.`);
			this.logger.error(e);
		}

		dataSync.deleteFileForUser(fileUrl);
	}

	async generateResponseToInvitation(baseUrl, invitationUrl, userWebId, interlocutorWebId, response) {
		const rsvpUrl = await this.generateUniqueUrlForResource(baseUrl);
		let responseUrl;

		if (response === 'yes') {
			responseUrl = namespaces.schema + 'RsvpResponseYes';
		} else if (response === "no") {
			responseUrl = namespaces.schema + 'RsvpResponseNo';
		} else {
			throw new Error(`The parameter "response" expects either "yes" or "no". Instead, "${response}" was provided.`);
		}

		const notification = `<${invitationUrl}> <${namespaces.schema}result> <${rsvpUrl}>.`;
		const sparqlUpdate = `
    <${rsvpUrl}> a <${namespaces.schema}RsvpAction>;
      <${namespaces.schema}rsvpResponse> <${responseUrl}>;
      <${namespaces.schema}agent> <${userWebId}>;
      <${namespaces.schema}recipient> <${interlocutorWebId}>.
      
    <${invitationUrl}> <${namespaces.schema}result> <${rsvpUrl}>.
  `;

		return {
			notification,
			sparqlUpdate
		};
	}

	async processChatToJoin(chat, fileurl) {
		chat.fileUrl = fileurl;
		chat.name = "Chat de ";
		//console.log(chat.friendWebId);
		chat.interlocutorName = await this.getFormattedName(chat.friendWebId.id);
		//console.log(chat);
		return chat;
	}

	/**
	 * This method returns the chat of an invitation.
	 * @param url: the url of the invitation.
	 * @returns {Promise}: a promise that returns the url of the chat (NamedNode) or null if none is found.
	 */
	async getChatFromInvitation(url) {
		return this.getObjectFromPredicateForResource(url, namespaces.schema + 'event');
	}

	async storeMessage(userDataUrl, username, userWebId, time, message, interlocutorWebId, dataSync, toSend) {
		
		const messageTx = message.replace(/ /g,"U+0020");
		const psUsername = username.replace(/ /g,"U+0020");

		const messageUrl = await this.generateUniqueUrlForResource(userDataUrl);
		const sparqlUpdate = `
		<${messageUrl}> a <${namespaces.schema}Message>;
		  <${namespaces.schema}dateSent> <${time}>;
		  <${namespaces.schema}givenName> <${psUsername}>;
		  <${namespaces.schema}text> <${messageTx}>.
	  `;
		//<${namespaces.schema}dateCreated> <${time}>;
		try {
			await dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${sparqlUpdate}}`);
		} catch (e) {
			console.log("NO GUARDA");
			this.logger.error(`Could not save new message.`);
			this.logger.error(e);
		}

		if (toSend) {
			try {
				await dataSync.sendToInterlocutorInbox(await this.getInboxUrl(interlocutorWebId), sparqlUpdate);
			} catch (e) {
				this.logger.error(`Could not send message to interlocutor.`);
				console.log("Could not send");
				this.logger.error(e);
			}
		}

	}

	async getNewMessage(fileurl, userWebId) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileurl, this.fetch);
		console.log("DA");
		if (rdfjsSource) {
			const engine = newEngine();
			let messageFound = false;
			const self = this;
			//<${namespaces.schema}dateCreated> ?time;
			engine.query(`SELECT * {
				?message a <${namespaces.schema}Message>;
					<${namespaces.schema}dateSent> ?time;
					<${namespaces.schema}givenName> ?username;
					<${namespaces.schema}text> ?msgtext.
			}`, {
					sources: [{
						type: 'rdfjsSource',
						value: rdfjsSource
					}]
				})
				.then(function (result) {
					result.bindingsStream.on('data', async function (result) {
						//console.log(result);
						messageFound = true;
						result = result.toObject();
						const messageUrl = result['?message'].value;
						const messageTx = result['?msgtext'].value.split("/inbox/")[1].replace(/U\+0020/g, " ");
						const author = result['?username'].value.replace(/U\+0020/g, " ");
						const time = result['?time'].value.split("/")[4];
						const inboxUrl = fileurl;
						deferred.resolve({
							inboxUrl,
							messageTx,
							messageUrl,
							author,
							time
						});
					});

					result.bindingsStream.on('end', function () {
						if (!messageFound) {
							deferred.resolve(null);
						}
					});
				});
		} else {
			deferred.resolve(null);
		}

		return deferred.promise;
	}

	async fileContainsChatInfo(fileUrl) {
		const deferred = Q.defer();
		const rdfjsSource = await rdfjsSourceFromUrl(fileUrl, this.fetch);
		const engine = newEngine();

		engine.query(`SELECT * {
    OPTIONAL { ?s a <${namespaces.schema}InviteAction>.}
    OPTIONAL { ?s a <${namespaces.schema}Message> ?o; <${namespaces.schema}text> ?t.}
  }`, {
				sources: [{
					type: 'rdfjsSource',
					value: rdfjsSource
				}]
			})
			.then(function (result) {
				result.bindingsStream.on('data', data => {
					console.log(result);
					deferred.resolve(true);
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(false);
				});
			});

		return deferred.promise;
	}

	async getAllResourcesInInbox(inboxUrl) {
		const deferred = Q.defer();
		const resources = [];
		const rdfjsSource = await rdfjsSourceFromUrl(inboxUrl, this.fetch);
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
					resources.push(resource);
				});

				result.bindingsStream.on('end', function () {
					deferred.resolve(resources);
				});
			});

		return deferred.promise;
	}

}
module.exports = DeChatCore;
