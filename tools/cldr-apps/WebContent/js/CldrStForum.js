'use strict';

/**
 * cldrStForum: encapsulate main Survey Tool Forum code.
 *
 * Use an IIFE pattern to create a namespace for the public functions,
 * and to hide everything else, minimizing global scope pollution.
 * Ideally this should be a module (in the sense of using import/export),
 * but not all Survey Tool JavaScript code is capable yet of being in modules
 * and running in strict mode.
 *
 * Dependencies on external code:
 * window.surveyCurrentLocale, window.surveySessionId, window.surveyUser, window.locmap,
 * createGravitar, stui.str, listenFor, bootstrap.js, reloadV, contextPath,
 * surveyCurrentSpecial, showInPop2, hideLoader, ...!
 *
 * TODO: possibly move these functions here from survey.js: showForumStuff, havePosts, updateInfoPanelForumPosts, appendForumStuff;
 * also some/all code from forum.js
 */
const cldrStForum = (function() {

	const FORUM_DEBUG = false;

	function forumDebug(s) {
		if (FORUM_DEBUG) {
			console.log(s);
		}
	}

	/**
	 * The locale, like "fr_CA", for which to show Forum posts.
	 * This module has persistent data for only one locale at a time, except that sublocales may be
	 * combined, such as "fr_CA" combined with "fr".
	 * Caution: the locale for a reply must exactly match the locale for the post to which it's a reply,
	 * so the locale for a particular post might for example be "fr" even though forumLocale is "fr_CA",
	 * or vice-versa.
	 */
	let forumLocale = null;

	/**
	 * The time when the posts were last updated from the server
	 */
	let forumUpdateTime = null;

	/**
	 * Mapping from post id to post object, describing the most recently parsed
	 * full set of posts from the server
	 */
	let postHash = {};

	/**
	 * Mapping from thread id to array of post objects, describing the most recently parsed
	 * full set of posts from the server
	 */
	let threadHash = {};

	/**
	 * Fetch the Forum data from the server, and "load" it
	 *
	 * @param locale the locale string, like "fr_CA" (surveyCurrentLocale)
	 * @param forumMessage the forum message
	 * @param params an object with various properties such as exports, special, flipper, otherSpecial, name, ...
	 */
	function loadForum(locale, userId, forumMessage, params) {
		setLocale(locale);
		const url = getLoadForumUrl();
		const errorHandler = function(err) {
			// const responseText = cldrStAjax.errResponseText(err);
			params.special.showError(params, null, {err: err, what: "Loading forum data"});
		};
		const loadHandler = function(json) {
			if (json.err) {
				if (params.special) {
					params.special.showError(params, json, {what: "Loading forum data"});
				}
				return;
			}
			// set up the 'right sidebar'
			showInPop2(forumStr(params.name + "Guidance"), null, null, null, true); /* show the box the first time */

			const ourDiv = document.createElement("div");
			ourDiv.appendChild(forumCreateChunk(forumMessage, "h4", ""));

			const filterMenu = cldrStForumFilter.createMenu(reloadV);
			const summaryDiv = document.createElement("div");
			summaryDiv.innerHTML = '';
			ourDiv.appendChild(summaryDiv);
			ourDiv.appendChild(filterMenu);
			ourDiv.appendChild(document.createElement('hr'));
			const posts = json.ret;
			if (posts.length == 0) {
				ourDiv.appendChild(forumCreateChunk(forumStr("forum_noposts"), "p", "helpContent"));
			} else {
				const content = parseContent(posts, 'main');
				ourDiv.appendChild(content);
				summaryDiv.innerHTML = getForumSummaryHtml(forumLocale, userId); // after parseContent
			}
			// No longer loading
			hideLoader(null);
			params.flipper.flipTo(params.pages.other, ourDiv);
			params.special.handleIdChanged(surveyCurrentId); // rescroll.
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Make a new forum post or a reply.
	 *
	 * @param params the object containing various parameters: locale, xpath, replyTo, replyData, ...
	 */
	function openPostOrReply(params) {
		const isReply = (params.replyTo && params.replyTo >= 0) ? true : false
		const replyTo = isReply ? params.replyTo : -1;
		const parentPost = (isReply && params.replyData) ? params.replyData : null;
		const firstPost = parentPost ? getOldestPostInThread(parentPost) : null;
		const locale = isReply ? firstPost.locale : (params.locale ? params.locale : '');
		const xpath = isReply ? firstPost.xpath : (params.xpath ? params.xpath : '');
		const subjectParam = params.subject ? params.subject : '';
		const postType = params.postType ? params.postType : null;
		const html = makePostHtml(postType, locale, xpath, replyTo);
		const subject = makePostSubject(isReply, parentPost, subjectParam);
		const myValue = params.myValue ? params.myValue : null;
		const text = prefillPostText(postType, myValue);

		openPostWindow(html, subject, text, parentPost);
	}

	/**
	 * Assemble the form and related html elements for creating a forum post
	 *
	 * @param postType the verb, such as 'Discuss'
	 * @param locale the locale string
	 * @param xpath the xpath string
	 * @param replyTo the post id of the post being replied to, or -1
	 */
	function makePostHtml(postType, locale, xpath, replyTo) {
		let html = '';

		html += '<form role="form" id="post-form">';
		html += '<div class="form-group">';
		html += '<div class="input-group">';
		html += '<span class="input-group-addon">Subject:</span>';
		html += '<input class="form-control" name="subj" type="text" value="">';
		html += '</div>'; // input-group
		html += '<div id="postType" class="pull-right postType">' + postType + '</div>';
		html += '<textarea name="text" class="form-control" placeholder="Write your post here"></textarea>';
		html += '</div>'; // form-group
		html += '<button class="btn btn-success submit-post btn-block">Submit</button>';
		html += '<input type="hidden" name="forum" value="true">';
		html += '<input type="hidden" name="_" value="' + locale + '">';
		html += '<input type="hidden" name="xpath" value="' + xpath + '">';
		html += '<input type="hidden" name="replyTo" value="' + replyTo + '">';
		html += '</form>';

		html += '<div class="post"></div>';
		html += '<div class="forumDiv"></div>';

		return html;
	}

	/**
	 * Make the subject string for a forum post
	 *
	 * @param isReply is this a reply? True or false
	 * @param parentPost the post object for the post being replied to, or null
	 * @param subjectParam the subject for this post supplied in parameters
	 * @return the string
	 */
	function makePostSubject(isReply, parentPost, subjectParam) {
		if (isReply && parentPost) {
			let subject = post2text(parentPost.subject);
			if (subject.substring(0, 3) != 'Re:') {
				subject = 'Re: ' + subject;
			}
			return subject;
		}
		return subjectParam;
	}

	/**
	 * Make the text (body) string for a forum post
	 *
	 * @param postType the verb such as 'Request', 'Discuss', ...
	 * @param myValue the value the current user voted for, or null
	 * @return the string
	 */
	function prefillPostText(postType, myValue) {
		if (postType === 'Close') {
			return "I'm closing this thread";
		} else if (postType === 'Request') {
			if (myValue) {
				return 'Please consider voting for ' + myValue + '\n';
			}
		} else if (postType === 'Agree') {
			return 'I agree';
		} else if (postType === 'Decline') {
			return 'I decline, since ';
		}
		return '';
	}

	/**
	 * Open a window displaying the form for creating a post
	 *
	 * @param subject the subject string
	 * @param html the main html for the form
	 * @param parentPost the post object, if any, to which this is a reply, for display at the bottom of the window
	 *
	 * Reference: Bootstrap.js post-modal: https://getbootstrap.com/docs/4.1/components/modal/
	 */
	function openPostWindow(html, subject, text, parentPost) {
		const postModal = $('#post-modal');
		postModal.find('.modal-body').html(html);
		postModal.find('input[name=subj]')[0].value = subject;
		$('#post-form textarea[name=text]').val(text);

		if (parentPost) {
			const forumDiv = parseContent([parentPost], 'parent');
			const postHolder = postModal.find('.modal-body').find('.forumDiv');
			postHolder[0].appendChild(forumDiv);
		}
		postModal.modal();
		postModal.find('textarea').autosize();
		postModal.find('.submit-post').click(submitPost);
		setTimeout(function() {
			postModal.find('textarea').focus();
		}, 1000 /* one second */);
	}

	/**
	 * Submit a forum post
	 *
	 * @param event
	 */
	function submitPost(event) {
		const text = $('#post-form textarea[name=text]').val();
		if (text) {
			reallySubmitPost(text);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	/**
	 * Submit a forum post
	 *
	 * @param text the non-empty body of the message
	 */
	function reallySubmitPost(text) {
		$('#post-form button').fadeOut();
		$('#post-form .input-group').fadeOut(); // subject line

		const xpath = $('#post-form input[name=xpath]').val();
		const locale = $('#post-form input[name=_]').val();
		const replyTo = $('#post-form input[name=replyTo]').val();
		const subj = $('#post-form input[name=subj]').val();
		const postType = document.getElementById('postType').innerHTML;
		const url = contextPath + "/SurveyAjax";

		const errorHandler = function(err) {
			const responseText = cldrStAjax.errResponseText(err);
			const post = $('.post').first();
			post.before("<p class='warn'>error! " + err + " " + responseText + "</p>");
		};
		const loadHandler = function(data) {
			if (data.err) {
				const post = $('.post').first();
				post.before("<p class='warn'>error: " + data.err + "</p>");
			} else if (data.ret && data.ret.length > 0) {
				const postModal = $('#post-modal');
				postModal.modal('hide');
				if (surveyCurrentSpecial && surveyCurrentSpecial === 'forum') {
					reloadV();
				} else {
					updateInfoPanelForumPosts(null);
				}
			} else {
				const post = $('.post').first();
				post.before("<i>Your post was added, #" + data.postId + " but could not be shown.</i>");
			}
		};
		const postData = {
			s: surveySessionId,
			"_": locale,
			replyTo: replyTo,
			xpath: xpath,
			text: text,
			subj: subj,
			postType: postType,
			what: "forum_post"
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler,
			postData: postData
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Create a DOM object referring to this set of forum posts
	 *
	 * @param posts the array of forum post objects, newest first
	 * @param context the string defining the context
	 *
	 * @return new DOM object
	 *
	 * TODO: shorten this function by moving code into subroutines. Also, postpone creating
	 * DOM elements until finished constructing the filtered list of threads, to make the code
	 * cleaner, faster, and more testable. If context is 'summary', all DOM element creation here
	 * is a waste of time.
	 *
	 * Threading has been revised, so that the same locale+path can have multiple distinct threads,
	 * rather than always combining posts with the same locale+path into a single "thread".
	 * Reference: https://unicode-org.atlassian.net/browse/CLDR-13695
	 */
	function parseContent(posts, context) {
		const opts = getOptionsForContext(context);

		updateForumData(posts, opts.fullSet);

		const postDivs = {}; //  postid -> div
		const topicDivs = {}; // xpath -> div or "#123" -> div

		/*
		 * create the topic (thread) divs -- populate topicDivs with DOM elements
		 *
		 * TODO: skip this loop if opts.createDomElements is false. Currently we have to do this even
		 * if opts.createDomElements if false, since filterAndAssembleForumThreads depends on topicDivs.
		 */
		for (let num in posts) {
			const post = posts[num];
			if (!topicDivs[post.threadId]) {
				// add the topic div
				const topicDiv = document.createElement('div');
				topicDiv.className = 'well well-sm postTopic';
				if (opts.showItemLink) {
					const topicInfo = forumCreateChunk("", "h4", "postTopicInfo");
					topicDiv.appendChild(topicInfo);
					if (post.locale) {
						const localeLink = forumCreateChunk(locmap.getLocaleName(post.locale), "a", "localeName");
						if (post.locale != surveyCurrentLocale) {
							localeLink.href = linkToLocale(post.locale);
						}
						topicInfo.appendChild(localeLink);
					}
					if (post.xpath) {
						topicInfo.appendChild(makeItemLink(post));
					}
					addThreadSubjectSpan(topicInfo, getOldestPostInThread(post));
				}
				topicDivs[post.threadId] = topicDiv;
				topicDiv.id = "fthr_" + post.threadId;
			}
		}
		// Now, top to bottom, just create the post divs
		for (let num in posts) {
			const post = posts[num];

			const subpost = forumCreateChunk("", "div", "post");
			postDivs[post.id] = subpost;
			subpost.id = "fp" + post.id;

			const headingLine = forumCreateChunk("", "h4", "selected");

			// If post.posterInfo is undefined, don't crash; insert "[Poster no longer active]".
			if (!post.posterInfo) {
				headingLine.appendChild(forumCreateChunk("[Poster no longer active]", "span", ""));
			} else {
				/*
				 * TODO: encapsulate "createGravitar" dependency
				 */
				let gravitar;
				if (typeof createGravitar !== 'undefined') {
					gravitar = createGravitar(post.posterInfo);
				} else {
					gravitar = document.createTextNode('');
				}
				gravitar.className = "gravitar pull-left";
				subpost.appendChild(gravitar);
				/*
				 * TODO: encapsulate "surveyUser" dependency
				 */
				if (typeof surveyUser !== 'undefined' && post.posterInfo.id === surveyUser.id) {
					headingLine.appendChild(forumCreateChunk(forumStr("user_me"), "span", "forum-me"));
				} else {
					const usera = forumCreateChunk(post.posterInfo.name + ' ', "a", "");
					if (post.posterInfo.email) {
						usera.appendChild(forumCreateChunk("", "span", "glyphicon glyphicon-envelope"));
						usera.href = "mailto:" + post.posterInfo.email;
					}
					headingLine.appendChild(usera);
					headingLine.appendChild(document.createTextNode(' (' + post.posterInfo.org + ') '));
				}
				const userLevelChunk = forumCreateChunk(forumStr("userlevel_" + post.posterInfo.userlevelName), "span", "userLevelName label-info label");
				userLevelChunk.title = forumStr("userlevel_" + post.posterInfo.userlevelName + "_desc");
				headingLine.appendChild(userLevelChunk);
			}
			let date = fmtDateTime(post.date_long);
			if (post.version) {
				date = "[v" + post.version + "] " + date;
			}
			const dateChunk = forumCreateChunk(date, "span", "label label-primary pull-right forumLink");
			(function(post) {
				/*
				 * TODO: encapsulate "listenFor" and "reloadV" dependencies
				 */
				if (typeof listenFor === 'undefined') {
					return;
				}
				listenFor(dateChunk, "click", function(e) {
					if (post.locale && locmap.getLanguage(surveyCurrentLocale) != locmap.getLanguage(post.locale)) {
						surveyCurrentLocale = locmap.getLanguage(post.locale);
					}
					surveyCurrentPage = '';
					surveyCurrentId = post.id;
					replaceHash(false);
					if (surveyCurrentSpecial != 'forum') {
						surveyCurrentSpecial = 'forum';
						reloadV();
					}
					return stStopPropagation(e);
				});
			})(post);
			headingLine.appendChild(dateChunk);
			subpost.appendChild(headingLine);

			const subSubChunk = forumCreateChunk("", "div", "postHeaderInfoGroup");
			subpost.appendChild(subSubChunk);
			const subChunk = forumCreateChunk("", "div", "postHeaderItem");
			subSubChunk.appendChild(subChunk);
			subChunk.appendChild(forumCreateChunk(post.postType, 'div', 'postTypeLabel'));

			// actual text
			const postText = post2text(post.text);
			const postContent = forumCreateChunk(postText, "div", "postContent postTextBorder");
			subpost.appendChild(postContent);

			if (opts.showReplyButton && (post === getNewestPostInThread(post))) {
				addReplyButtons(subpost, post);
			}
		}
		// reparent any nodes that we can
		for (let num in posts) {
			const post = posts[num];
			if (post.parent != -1) {
				forumDebug("reparenting " + post.id + " to " + post.parent);
				if (postDivs[post.parent]) {
					if (!postDivs[post.parent].replies) {
						// add the "replies" area
						forumDebug("Adding replies area to " + post.parent);
						postDivs[post.parent].replies = forumCreateChunk("", "div", "postReplies");
						postDivs[post.parent].appendChild(postDivs[post.parent].replies);
					}
					// add to new location
					postDivs[post.parent].replies.appendChild(postDivs[post.id]);
				} else {
					// The parent of this post was deleted.
					forumDebug("The parent of post #" + post.id + " is " + post.parent + " but it was deleted or not visible");
					// link it in somewhere
					topicDivs[post.threadId].appendChild(postDivs[post.id]);
				}
			} else {
				// 'top level' post
				topicDivs[post.threadId].appendChild(postDivs[post.id]);
			}
		}
		return filterAndAssembleForumThreads(posts, topicDivs, opts.applyFilter, opts.showThreadCount);
	}

	/**
	 * Update several persistent data structures to describe the given set of posts
	 *
	 * @param posts the array of post objects, from newest to oldest
	 * @param fullSet true if we should start fresh with these posts
	 */
	function updateForumData(posts, fullSet) {
		if (fullSet) {
			postHash = {};
			threadHash = {};
		}
		updatePostHash(posts);
		addThreadIds(posts);
		updateThreadHash(posts);
		forumUpdateTime = Date.now();
	}

	/**
	 * Update the postHash mapping from post id to post object
	 *
	 * @param posts the array of post objects, from newest to oldest
	 */
	function updatePostHash(posts) {
		posts.forEach(function(post) {
			postHash[post.id] = post;
		});
	}

	/**
	 * Add a "threadId" attribute to each post object in the given array
	 *
	 * For a post with a parent, the thread id is the same as the thread id of the parent.
	 *
	 * For a post without a parent, the thread id is like "aa|1234", where aa is the locale and 1234 is the post id.
	 *
	 * Make sure that the thread id uses the locale of the first post in its thread, for consistency.
	 * Formerly, a post could have a different locale than the first post. For example, even though
	 * post 32034 is fr_CA, its child 32036 was fr. That bug is believed to have been fixed, in the
	 * code and in the db.
	 *
	 * @param posts the array of post objects
	 */
	function addThreadIds(posts) {
		posts.forEach(function(post) {
			const firstPost = getOldestPostInThread(post);
			post.threadId = firstPost.locale + "|" + firstPost.id;
		});
	}

	/**
	 * Update the threadHash mapping from threadId to an array of all the posts in that thread
	 *
	 * @param posts the array of post objects, from newest to oldest
	 *
	 * The posts are assumed to have threadId set already by addThreadIds.
	 */
	function updateThreadHash(posts) {
		posts.forEach(function(post) {
			const threadId = post.threadId;
			if (!(threadId in threadHash)) {
				threadHash[threadId] = [];
			}
			threadHash[threadId].push(post);
		});
	}

	/**
	 * Make a hyperlink from the given post to the the same post in the main Forum window
	 *
	 * @param post the post object
	 * @return the DOM element
	 */
	function makeItemLink(post) {
		const itemLink = forumCreateChunk(forumStr("forum_item"), "a", "pull-right postItem glyphicon glyphicon-zoom-in");
		itemLink.href = "#/" + post.locale + "//" + post.xpath;
		return itemLink;
	}

	/**
	 * Make a span containing a subject line for the specified thread
	 *
	 * @param topicInfo the DOM element to which to attach the span
	 * @param firstPost the oldest post in the thread
	 */
	function addThreadSubjectSpan(topicInfo, firstPost) {
		/*
		 * Starting with CLDR v38, posts should all have post.xpath, and post.subject
		 * should be like "Characters | Typography | Style | wght-900-heavy" (recognizable
		 * by containing the character '|'), constructed from the xpath and path-header when
		 * the post is created.
		 *
		 * In such normal cases (or if there is no xpath), the thread subject is the same as
		 * the subject of the oldest post in the thread.
		 */
		if (firstPost.subject.indexOf('|') >= 0 || !firstPost.xpath) {
			topicInfo.appendChild(forumCreateChunk(post2text(firstPost.subject), "span", "topicSubject"));
			return;
		}
		/*
		 * Some old posts have subjects like "Review" or "Flag Removed".
		 * In this case, construct a new subject based on the xpath and path-header.
		 * This is awkward since xpathMap.get is asynchronous. Display the word
		 * "Loading" as a place-holder while waiting for the result.
		 */
		const loadingMsg = forumCreateChunk(forumStr("loading"), "i", "loadingMsg");
		topicInfo.appendChild(loadingMsg);
		xpathMap.get({
			hex: firstPost.xpath
		}, function(o) {
			if (o.result) {
				topicInfo.removeChild(loadingMsg);
				const itemPh = forumCreateChunk(xpathMap.formatPathHeader(o.result.ph), "span", "topicSubject");
				itemPh.title = o.result.path;
				topicInfo.appendChild(itemPh);
			}
		});
	}

	/**
	 * Make one or more new-post buttons for the given post, and append them to the given element
	 *
	 * @param el the DOM element to append to
	 * @param locale the locale
	 * @param couldFlag true if the user could add a flag for this path, else false
	 * @param xpstrid the xpath string id
	 * @param code the "code" for the xpath
	 * @param myValue the value the current user voted for, or null
	 */
	function addNewPostButtons(el, locale, couldFlag, xpstrid, code, myValue) {
		const options = getStatusOptions(false /* isReply */, null /* firstPost */, myValue);

		Object.keys(options).forEach(function(postType) {
			el.appendChild(makeOneNewPostButton(postType, options[postType], locale, couldFlag, xpstrid, code, myValue));
		});
	}

	/**
	 * Make one or more reply buttons for the given post, and append them to the given element
	 *
	 * @param el the DOM element to append to
	 * @param post the post
	 */
	function addReplyButtons(el, post) {
		const firstPost = getOldestPostInThread(post);
		const options = getStatusOptions(true /* isReply */, firstPost, null /* myValue */);

		Object.keys(options).forEach(function(postType) {
			el.appendChild(makeOneReplyButton(post, postType, options[postType]));
		});
	}

	function makeOneNewPostButton(postType, label, locale, couldFlag, xpstrid, code, myValue) {

		const buttonTitle = couldFlag ? "forumNewPostFlagButton" : "forumNewPostButton";

		const buttonClass = couldFlag ? "forumNewPostFlagButton btn btn-default btn-sm"
									: "forumNewButton btn btn-default btn-sm";

		const newButton = forumCreateChunk(label, "button", buttonClass);

		if (typeof listenFor !== 'undefined') {
			listenFor(newButton, "click", function(e) {
				xpathMap.get({
					hex: xpstrid
				},
				function(o) {
					let subj = code + ' ' + xpstrid;
					if (o.result && o.result.ph) {
						subj = xpathMap.formatPathHeader(o.result.ph);
					}
					if (couldFlag) {
						subj += " (Flag for review)";
					}
					openPostOrReply({
						locale: locale,
						xpath: xpstrid,
						subject: subj,
						postType: postType,
						myValue: myValue
					});
				});
				stStopPropagation(e);
				return false;
			});
		}
		return newButton;
	}

	function makeOneReplyButton(post, postType, label) {
		const replyButton = forumCreateChunk(label, "button", "btn btn-default btn-sm");
		/*
		 * TODO: encapsulate "listenFor" dependency
		 */
		if (typeof listenFor !== 'undefined') {
			listenFor(replyButton, "click", function(e) {
				openPostOrReply({
					/*
					 * Don't specify locale or xpath for reply. Instead they will be set to
					 * match the original post in the thread.
					 */
					replyTo: post.id,
					replyData: post,
					postType: postType
				});
				stStopPropagation(e);
				return false;
			});
		}
		return replyButton;
	}

	/**
	 * Get an object defining the currently allowed forum status values
	 * for making a new post, for the current user and given parameters
	 *
	 * @param isReply true if this post is a reply, else false
	 * @param firstPost the original post in the thread
	 * @param myValue the value the current user voted for, or null
	 * @return the object mapping verbs like 'Request' to label strings like 'Request'
	 *         (Currently the labels are the same as the verbs)
	 *
	 * Compare SurveyForum.ForumStatus on server
	 */
	function getStatusOptions(isReply, firstPost, myValue) {
		const options = {};
		if (myValue && !isReply) { // only allow Request if this user has voted
			options['Request'] = 'Request';
		}
		options['Discuss'] = 'Discuss';
		if (isReply && firstPost && !userIsPoster(firstPost) && firstPost.status === 'Request') {
			options['Agree'] = 'Agree';
			options['Decline'] = 'Decline';
		}
		if (userCanClose(isReply, firstPost)) {
			options['Close'] = 'Close';
		}
		return options;
	}

	/**
	 * Is the current user the poster of this post?
	 *
	 * @param post the post, or null
	 * @returns true or false
	 */
	function userIsPoster(post) {
		if (post && typeof surveyUser !== 'undefined') {
			if (surveyUser === post.poster) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Is the current user a TC (Technical Committee) member?
	 *
	 * @return true or false
	 */
	function userIsTC() {
		if (typeof surveyUserPerms !== 'undefined' && surveyUserPerms.userIsTC) {
			return true;
		}
		return false;
	}

	/**
	 * Is this user allowed to close the thread now?
	 *
	 * The user is only allowed if they are the original poster of the thread,
	 * or a TC (technical committee) member.
	 *
	 * @param isReply true if this post is a reply, else false
	 * @param firstPost the original post in the thread, or null
	 * @return true if this user is allowed to close, else false
	 */
	function userCanClose(isReply, firstPost) {
		return isReply
			&& !threadIsClosed(firstPost)
			&& (userIsPoster(firstPost) || userIsTC());
	}

	/**
	 * Is this thread closed?
	 *
	 * @param firstPost the original post in the thread, or null
	 * @return true if this user is allowed to close, else false
	 */
	function threadIsClosed(firstPost) {
		const threadPosts = threadHash[firstPost.threadId];
		return cldrStForumFilter.passIfClosed(threadPosts);
	}

	/**
	 * Get an object whose properties define the parseContent options to be used for a particular
	 * context in which parseContent is called
	 *
	 * @param context the string defining the context:
	 *
	 *   'main' for the context in which "Forum" is chosen from the left sidebar
	 *
	 *   'summary' for the context of getForumSummaryHtml
	 *
	 *   'info' for the "Info Panel" context (either main vetting view row, or Dashboard "Fix" button)
	 *
	 *   'parent' for the replied-to post at the bottom of the create-reply dialog
	 *
	 * @return an object with these properties:
	 *
	 *   showItemLink = true if there should be an "item" (xpath) link
	 *
	 *   showReplyButton = true if there should be a reply button
	 *
	 *   fullSet = true if this is a full set of posts
	 *
	 *   applyFilter = true if the currently menu-selected filter should be applied
	 *
	 *   showThreadCount = true to display the number of threads
	 *
	 *   createDomElements = true to create the DOM objects (false for summary)
	 */
	function getOptionsForContext(context) {
		const opts = getDefaultParseOptions();
		if (context === 'main') {
			opts.showItemLink = true;
			opts.showReplyButton = true;
			opts.applyFilter = true;
			opts.showThreadCount = true;
		} else if (context === 'summary') {
			opts.applyFilter = true;
			opts.createDomElements = false;
		} else if (context === 'info') {
			opts.showReplyButton = true;
		} else if (context === 'parent') {
			opts.fullSet = false;
		} else {
			console.log('Unrecognized context in getOptionsForContext: ' + context)
		}
		return opts;
	}

	/**
	 * Get the default parseContent options
	 *
	 * @return a new object with the default properties
	 */
	function getDefaultParseOptions() {
		const opts = {};
		opts.showItemLink = false;
		opts.showReplyButton = false;
		opts.fullSet = true;
		opts.applyFilter = false;
		opts.showThreadCount = false;
		opts.createDomElements = true;
		return opts;
	}

	/**
	 * Convert the given text by replacing some html with plain text
	 *
	 * @param the plain text
	 */
	function post2text(text) {
		if (text === undefined || text === null) {
			text = "(empty)";
		}
		let out = text;
		out = out.replace(/<p>/g, '\n');
		out = out.replace(/&quot;/g, '"');
		out = out.replace(/&lt;/g, '<');
		out = out.replace(/&gt;/g, '>');
		out = out.replace(/&amp;/g, '&');
		return out;
	}

	/**
	 * Create a DOM object with the specified text, tag, and HTML class.
	 *
	 * @param text textual content of the new object, or null for none
	 * @param tag which element type to create, or null for "span"
	 * @param className CSS className, or null for none.
	 * @return new DOM object
	 *
	 * This duplicated a function in survey.js; copied here to avoid the dependency
	 */
	function forumCreateChunk(text, tag, className) {
		if (!tag) {
			tag = "span";
		}
		const chunk = document.createElement(tag);
		if (className) {
			chunk.className = className;
		}
		if (text) {
			chunk.appendChild(document.createTextNode(text));
		}
		return chunk;
	}

	/**
	 * Get the first (original) post in the thread containing this post
	 *
	 * @param post the post object
	 * @return the first post in the thread
	 */
	function getOldestPostInThread(post) {
		while (post.parent >= 0 && postHash[post.parent]) {
			post = postHash[post.parent];
		}
		return post;
	}

	/**
	 * Get the last (most recent) post in the thread containing this post
	 *
	 * @param post the post object
	 * @return the first post in the thread
	 */
	function getNewestPostInThread(post) {
		const threadPosts = threadHash[post.threadId];
		/*
		 * threadPosts is ordered from newest to oldest
		 */
		return threadPosts[0];
	}

	/**
	 * Filter the forum threads and assemble them into a new document fragment,
	 * ordering threads from newest to oldest, determining the time of each thread
	 * by the newest post it contains
	 *
	 * @param posts the array of post objects, from newest to oldest
	 * @param topicDivs the array of thread elements, indexed by threadId
	 * @param applyFilter true if the currently menu-selected filter should be applied
	 * @param showThreadCount true to display the number of threads
	 * @return the new document fragment
	 */
	function filterAndAssembleForumThreads(posts, topicDivs, applyFilter, showThreadCount) {
		let filteredArray = cldrStForumFilter.getFilteredThreadIds(threadHash, applyFilter);
		const forumDiv = document.createDocumentFragment();
		let countEl = null;
		if (showThreadCount) {
			countEl = document.createElement('h4');
			forumDiv.append(countEl);
		}
		let threadCount = 0;
		posts.forEach(function(post) {
			if (filteredArray.includes(post.threadId)) {
				++threadCount;
				/*
				 * Append the div for this threadId, then remove this threadId
				 * from filteredArray to prevent appending the same div again
				 * (which would move the div to the bottom, not duplicate it).
				 */
				forumDiv.append(topicDivs[post.threadId]);
				filteredArray = filteredArray.filter(id => (id !== post.threadId));
			}
		});
		if (showThreadCount) {
			countEl.innerHTML = threadCount + ((threadCount === 1) ? ' thread' : ' threads');
		}
		return forumDiv;
	}

	/**
	 * Convert the given short string into a human-readable string.
	 *
	 * TODO: encapsulate "stui" dependency better
	 *
	 * @param s the short string, like "forum_item" or "forum_reply"
	 * @return the human-readable string like "Item" or "Reply"
	 */
	function forumStr(s) {
		if (typeof stui !== 'undefined') {
			return stui.str(s);
		}
		return s;
	}

	/**
	 * Format a date and time for display in a forum post
	 *
	 * @param x the number of seconds since 1970-01-01
	 * @returns the formatted date and time as a string, like "2018-05-16 13:45"
	 */
	function fmtDateTime(x) {
		const d = new Date(x);

		function pad(n) {
			return (n < 10) ? '0' + n : n;
		}
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
			' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
	}

	/**
	 * Get a piece of html text summarizing the current Forum statistics
	 *
	 * @param locale the locale string
	 * @param userId the current user's id, for cldrStForumFilter
	 * @return the html
	 */
	function getForumSummaryHtml(locale, userId) {
		setLocale(locale);
		cldrStForumFilter.setUserId(userId);
		return reallyGetForumSummaryHtml(true /* canDoAjax */);
	}

	/**
	 * Get a piece of html text summarizing the current Forum statistics
	 *
	 * @param canDoAjax true to call loadForumForSummaryOnly if needed, false otherwise; should
	 *                  be false if the caller is the loadHandler for loadForumForSummaryOnly,
	 *                  to prevent endless back-and-forth if things go wrong
	 * @return the html
	 */
	function reallyGetForumSummaryHtml(canDoAjax) {
		const id = 'forumSummary';
		let html = "<div id='" + id + "'>\n";
		if (!forumUpdateTime) {
			if (canDoAjax) {
				html += "<p>Loading Forum Summary...</p>\n";
				loadForumForSummaryOnly(forumLocale, id)
			} else {
				html += "<p>Load failed</p>n";
			}
		} else {
			if (FORUM_DEBUG) {
				html += "<p>Retrieved " + fmtDateTime(forumUpdateTime) + "</p>\n";
			}
			const c = cldrStForumFilter.getFilteredThreadCounts();
			html += "<ul>\n";
			Object.keys(c).forEach(function(k) {
				html += "<li>" + k + ": " + c[k] + "</li>\n";
			});
			html += "</ul>\n";
		}
		html += '</div>\n';
		return html;
	}

	/**
	 * Fetch the Forum data from the server, and show a summary
	 *
	 * @param locale the locale
	 * @param id the id of the element to display the summary
	 */
	function loadForumForSummaryOnly(locale, id) {
		if (typeof cldrStAjax === 'undefined') {
			return;
		}
		setLocale(locale);
		const url = getLoadForumUrl();
		const errorHandler = function(err) {
			const el = document.getElementById(id);
			if (el) {
				el.innerHTML = cldrStAjax.errResponseText(err);
			}
		};
		const loadHandler = function(json) {
			const el = document.getElementById(id);
			if (!el) {
				return;
			}
			if (json.err) {
				el.innerHTML = 'Error';
				return;
			}
			const posts = json.ret;
			parseContent(posts, 'summary');
			el.innerHTML = reallyGetForumSummaryHtml(false /* do not reload recursively */); // after parseContent
		};
		const xhrArgs = {
			url: url,
			handleAs: 'json',
			load: loadHandler,
			error: errorHandler
		};
		cldrStAjax.sendXhr(xhrArgs);
	}

	/**
	 * Load or reload the main Forum page
	 */
	function reload() {
		window.surveyCurrentSpecial = 'forum';
		window.surveyCurrentId = '';
		window.surveyCurrentPage = '';
		reloadV();
	}

	/**
	 * Get the URL to use for loading the Forum
	 */
	function getLoadForumUrl() {
		if (typeof surveySessionId === 'undefined') {
			console.log('Error: surveySessionId undefined in getLoadForumUrl');
			return '';
		}
		return 'SurveyAjax?s=' + surveySessionId + '&what=forum_fetch&xpath=0&_=' + forumLocale;
	}

	/**
	 * If the given locale is not the one we've already loaded, switch to it,
	 * initializing data to avoid using data for the wrong locale
	 *
	 * @param locale the locale string, like "fr_CA" (surveyCurrentLocale)
	 */
	function setLocale(locale) {
		if (locale !== forumLocale) {
			forumLocale = locale;
			forumUpdateTime = null;
			postHash = {};
		}
	}

	function getThreadHash(posts) {
		updateForumData(posts, true /* fullSet */);
		return threadHash;
	}

	/*
	 * Make only these functions accessible from other files:
	 */
	return {
		parseContent: parseContent,
		getForumSummaryHtml: getForumSummaryHtml,
		loadForum: loadForum,
		reload: reload,
		addNewPostButtons: addNewPostButtons,
		/*
		 * The following are meant to be accessible for unit testing only:
		 */
		test: {
			getThreadHash: getThreadHash,
		}
	};
})();
