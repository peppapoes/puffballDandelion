## Assignment

Find a fragment shader you like on Shadertoy.com and port it to WebGPU. Embed it in a ThreeJS environment with the WebGPURenderer and make sure the shader responds to user interaction.

Submit a url where we can see your working experiment + your source code in separate assignments. Mention the original shader URL in a README.md at the root of your project. Do not submit node_modules.

Extra marks for:

Interaction which is more than just looking around
Integration of physics
Integration of multiple shaders
Integration of additional WebGPU libraries
Integration of your own Blender models, including baking.
Controlling animations from a Blender model.
BEWARE: The project needs to be fully functional online. Not online = no marks. Make sure to deploy early & often. You're free to choose how / where you deploy, although I'd recommend to use Git / Github throughout the project to have frequent backups of your project.


## New information & requirements

General remarks regarding react native assignment
Dear students,

As you're working on your react native assignment, there's a couple of general remarks I wanted to share with you, based upon the consults yesterday and today:

As you're writing code with the help of AI tools, make sure you have a good view of your application's architecture:
How does data flow in the application: where is data being managed? Where is external data (both api or locally stored data) being red and fed into your stores / state?
How are the views and components nested?
Make sure that for everything you see on the screen, you know exactly which files contain the logic to visualize that screen.
I'm seeing a lot of useMemos, useCallback hooks. These are ok, but none of you were able to explain to me what they do. Always do a review of the code that was generated, and make sure you understand every line. If not: look up those unknown functions in the documenation or ask your ai chatbot to explain them to you.
Use a zustand store to manage your shared state.
Avoid useEffects where possible. If the inside of a useEffect only manages state / data changes based upon other data changes, look into moving that logic directly into the data-setters of your store or in the event handlers that changed the initial data.
Finally, here are a few instructions you can put in your AGENTS.md or CLAUDE.md file that will make your agent help you learn (and of course you can always ask your agent to quiz you about your project, just like a teacher would grill you on a presentation or consult ;-)):

# before writing code
- Explain what you're about to do and why
- Break it down into steps I can follow
- Wait for my OK before proceeding

# after writing code
- Explain what each part does
- Ask me 3 questions to verify I understood
- If I answer wrong, explain again until I get it

# general rules
- Treat every session as a teaching opportunity