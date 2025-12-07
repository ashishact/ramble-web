We will radically change the system now. Currently the way this works is we have gemini live which does full duplex audio conversation. We don't want full duplex.

We will change it so that the user only speaks and the AI only listens - only when there is a special command the Ai will speak - which for the moment will not happen at all

We will have a new page at /radical which will be just blank now. at the bottom we will have a input box centered on y axis. Here no gemini live thing is happening.

In the database - we will have these collections:

1. DOCUMENTS - these are files or big text the user has uploaded. It will have timestamps and hash of the file as the pk/id
2. CONVERSATIONS - This is the conversation the user has talked, or typed - This will be list of messages - each message will will have a timestamp, sessionId, raw: the text the user typed or transcribed text, processed: a more processed version of the raw text when we do audio to text (because there could be pronounciation or spelling errors etc). When the raw text is same as the processed text then this will be null.
   1. One conversation can have multiple messages. messages will have a reference to the conversation (sessionId) each message will have a role: user | ai | oberver | system | .. we will add more if required. But mostly we will store just the user message here
3. SESSIONS - This is the session of the conversation 
   Structure: {id: string, name: string, description: string, tags: string[], privacy: string[], createdAt: timestamp, updatedAt: timestamp, 
   systemThinking: {summary: string, goals: string[], error: string[], plan: string[]},
   state: {} // an object that will have current state of the conversation any key:value items
   }



The primary architecture of this system will be based on this priciple
1. There is external content (file, docs, links) - which the user may or may not have in there brain
2. What the user says or writes - is coming from their own internal thoughts so we will consider them as the primary source of truth. That's why when they paste a copied text which is very long we will be sceptical of it - because it might be copied from somewhere else.
3. We will have a hirarchy of observer systems - The first observer will look at the conversation and create a raw knowledge base from it. We will put this in a knowledgebase collection.
4. KNOWLEDGEITEM
   Structure: {contents : {text: string, tags: [], category: string, privacy: string[]}[], createdAt: timestamp, updatedAt: timestamp, sessionId: string, entities: string[] }
   1. This will be list of sentences that are extracted from a single block of message. each text has to be one sentence that is a complete thought
   2. Entities - NER entities we can extract from the text
   3. there can be only one category and many tags.
   4. KNOWLEDGEITEM is the first observer - it will gather info and do a primary analysis of the ongoing  conversation and make a concise but accurate knowledge base.
   5. Once we get a knowledge item - we will send the entities to a function which will append to the ENTITIES collection
   6. The tags and category can only be from the list of available and commited tags and categories - nothing from outside.
5. TAGS - there will be a collection just for tags - this will have the structure : {name: string, description: string, color: string, icon: string, commit: {by: "user|ai", timestamp: timestamp}, suggested: {by: "user|ai", timestamp: timestamp, reason: string}}
   1. Commit here means the tag has been added and can be user - if it is not commited then it is just suggested by the ai - and we will not be using it.
   2. id for this collection will be the name of the tag
6. CATEGORIES - there will be a collection just for categories - this will have the structure : {name: string, description: string, color: string, icon: string, commit: {by: "user|ai", timestamp: timestamp}, suggested: {by: "user|ai", timestamp: timestamp, reason: string}}
   1. category name will be id for this collection
   2. there can be sub categories - but then they will be user with / between them - for example - "category/subcategory/subsubcategory"
7. PRIVACY - there will be a collection just for privacy - this will have the structure : {name: string, description: string, color: string, icon: string, commit: {by: "user|ai", timestamp: timestamp}, suggested: {by: "user|ai", timestamp: timestamp, reason: string}}
   1. id for this collection will be the name of the privacy
   2. The purpose of privacy is to scope the knowledge base so that we don't mix data from different context of the life of the user. We will have few starting privacy - 
   3. "public", "private", "friends", "family", "work", "school", "personal"
   4. we will use the private privacy to encrypt the data with a password or some other secret key 

1st Observer - Knowledge Item Observer
    1. This observer will have use the current state (conversation.state) and the raw/processed text of the conversation to create a knowledge item.
    2. This will run by a fast enough LLM with medium intelligence - it should be good enough to create a valid knowledge item and update the state.
    3. This will surgically update the state object by using the latest message.
    4. This will run every message in a queue - so that while this is running and 2 more message have already been added - it will next take those 2 messages and and run on them. So it will either run on 1 or 2 or as many were added since the last run.
1. 

2nd - Observer - Suggestion Observer
This observer will have use the current state and the first observer (knowledge base) to suggest what else the user should add. It can also put question to the user and ask for more information - it will be quite inquisitive and in general be an explorer of ideas. First it will suggest essential elements required and then it will suggest how the conversation or knowledge base can be improved or enriched with much better data. - it can also gently nudge the user in certain directions - so that novel ideas can be generated.
SUGGESTIONS - this is the collection of suggestions that the observer will suggest. Structure: {id: string, sessionId: string, contents: {}[], createdAt: timestamp, updatedAt: timestamp, category: string, tags: string[]}

   1. We will display these suggestions to the user as they are talking or typing - so that they can refine there thoughts - 
   2. This has to be run by a very fast LLM - so that there is no delay
   3. This also takes the current state 




## System 2 Thinker
1. From time to time we will have few observer which will consolidate the knowledge base and summarize the conversation - extract the most important points and suggest what really the user is doing. This is more like a system 2 thinker - which does deep thinking and analysis and makes 
   1. High level goals - and checks if the goals are being achieved
   2. planning - what really needs to be done
   3. error analysis - what are the steps that were taken but no success was found
   4. This is will run every 16 knowledge items added.
   5. This will also take the current state and last 16 knowledge items (number can be configurable) and do analysis.
   6. 
   7. This will be done by a powerful LLM and it's okay if this run slowly - we will do it very less frequently.
   8. If we stop a session and come back there again - we see that last session - had few (6 new knowledge items) added but the conversation doesn't have a full system 2 thinking - we will run on those few items - and update the conversation.systemThinking object
   9. It will have the ability (tools) to update the state object - and correct any mistake in the state or any knowledge item for this run (the 16 items we picked)


## Meta Suggestion Observer
   1. This observer's job is to suggest how the system is working and if any new structure is needed
   2. This will also have the  ability (tools) to suggest new tags and category that should be suggested - but it will not be commited.
   3. This we will run only sometime (configurable - once a day - usually when the user loads the page 5 minutes after that if we have not run for that day)
   4. This will be done by a powerful LLM and it's okay if this run slowly - we will do it max once a day.







* Everytime we load the page we will generate a new sessionId and keep in memory.
* Every oberver we should be able to run from an API - so that testing will be easy. expose an API
  


## UI
We will have a long list of conversations and each conversation will have a list of messages that we can pick and see. Similarly we will have list of tags, categories, privacy, and entities, Just first create a UI to dump everything.


When we load we will have a button - start recording when we click on this we will use the SST (first we will go with the groq wishper system we have). Each time we stop recording we will save it to a new message and save the conversation. This will trigger the 1st observer - that will trigger 2nd observer (Suggestion observer).

When we have more than 16 such messages  - the system 2 thinker will run and so on.

When we are having conversation I want to be able to see the result of all observer and SST


For the suggestion observer - we will use Groq openai-oss-120b
For the knowledge item observer  we will use gemini-2.5-flash
For the system 2 observer  we will use gemini-2.5-flash and forst rest also use the groq openai-oss-120b - check the model name properly I don't remember exactly