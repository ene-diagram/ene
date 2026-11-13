# @ene-diagram/cli

Command-line tool for [ene](https://github.com/ene-diagram/ene): render text diagrams to animated SVG, GIF or MP4, check and format `.ene` files.

```sh
npm i -g @ene-diagram/cli
```

```sh
ene diagram.ene                 # writes diagram.svg
ene diagram.ene -o diagram.gif  # GIF/MP4 need @ene-diagram/video, Chrome and ffmpeg
ene check diagram.ene           # report errors
ene fmt --write *.ene           # format in place
ene from-mermaid flow.mmd -o flow.ene  # convert a Mermaid flowchart or sequence diagram
ene --help
```

Syntax, examples and the other packages: [github.com/ene-diagram/ene](https://github.com/ene-diagram/ene). MIT license.
