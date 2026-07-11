* refactor the code into smaller files (usual threejs structure)
* shade black the top of the cubes that are far from interior
* add seeded world generation on the fly
* add a walking plane
* create a player ball that has collision with cubes and player is able to direct it (no pathfinding for now)
* change dragging camera from rmb to middle mouse button
* lmb click on cube neighbouring with interior removes it. the new chunk is generated and preferably swapped with the drawn chunk for performance (but maby this is not needed)
    * ~~pathfinding works on the client side~~ (done: A* + string-pulling in `src/path.js`, driven by `ball.moveTo`); only the next step is sent to the server 
* create se4rver and implement basic multiplayer:
    * server stores "touched" chunk state (only) in the db
    * server stores player positions
    * clients get updated with world state and their world is rebuilt based on that
        * consider the model: possibly each player needs to be assigned a "watched" chunks set, and server updates the player if any of those chaunks get changed
* how do i make remote server inspectable and iteractive to agents?
* allow for multiple controllable players balls (selectable)
* allow for selecting multiple cubes to dig (puttng them in digginq queue per player ball)
