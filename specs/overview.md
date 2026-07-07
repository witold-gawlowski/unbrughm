# Project Overview

## Concept

An MMO set on an infinite underground plane, in the style of Dungeon Keeper.
Each player controls a single creature that can dig through tiles, carving
out their own space in the plane.

Other players spawn on the server at different locations. There's no
overarching goal or win condition yet — the current purpose is simply
letting players dig through an infinite shared plane and encounter each
other as their tunnels meet.

## World persistence

Changes to the plane (dug tiles, etc.) are stored in the server's database
and streamed to interested players in chunks. See `mmo-networking.md` for
the chunk streaming and networking details.
