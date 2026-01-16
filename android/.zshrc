 export PATH="$PATH:$HOME/flutter/bin"

 
export PATH="/usr/local/opt/sqlite/bin:$PATH"

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/Users/woochangchang/anaconda3/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/Users/woochangchang/anaconda3/etc/profile.d/conda.sh" ]; then
        . "/Users/woochangchang/anaconda3/etc/profile.d/conda.sh"
    else
        export PATH="/Users/woochangchang/anaconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/build-tools/34.0.0


