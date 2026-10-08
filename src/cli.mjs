// flowmusic CLI: argument dispatch.
import { parseArgs } from "./lib/util.mjs";
import { HELP } from "./help.mjs";
import { createContext } from "./commands/context.mjs";
import create from "./commands/create.mjs";
import edit from "./commands/edit.mjs";
import library from "./commands/library.mjs";
import account from "./commands/account.mjs";

export { HELP };

const ALIASES = { generate: "gen", song: "gen", dl: "download", ls: "list", rm: "delete", fav: "favorite", unfav: "unfavorite" };

export async function run(argv) {
  const opts = parseArgs(argv);
  const c = createContext(opts);
  const cmds = { ...create(c), ...edit(c), ...library(c), ...account(c) };
  cmds.completion = () => {
    const names = Object.keys(cmds).concat(["help"]).sort();
    const shell = opts._[1] || "bash";
        if (shell === "zsh") console.log(`#compdef flowmusic\n_arguments '1:command:(${names.join(" ")})' '*::arg:_files'`);
        else console.log(`# add to ~/.bashrc:  eval "$(flowmusic completion bash)"\n_flowmusic() { local cur=\${COMP_WORDS[COMP_CWORD]}; if [ $COMP_CWORD -eq 1 ]; then COMPREPLY=($(compgen -W "${names.join(" ")}" -- "$cur")); else COMPREPLY=($(compgen -f -- "$cur")); fi; }\ncomplete -F _flowmusic flowmusic`);
  };

  const fn = cmds[ALIASES[opts._[0]] || opts._[0]];
  if (!fn) { console.log(HELP); return; }
  await fn();
}
