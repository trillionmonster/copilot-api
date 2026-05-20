#!/bin/bash
# ============================================================
# Claude Code / Codex 启动脚本
# 通过 copilot-api 代理使用 GitHub Copilot 模型
# ============================================================

set -e

PROXY_URL="http://localhost:4141"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Copilot API → Claude Code / Codex${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ---- 1. 检查 copilot-api 是否在运行 ----
echo -e "${YELLOW}[1/4] 检查 copilot-api 服务...${NC}"
if curl -s --noproxy localhost --max-time 5 "${PROXY_URL}/v1/models" > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ copilot-api 服务正常运行在 ${PROXY_URL}${NC}"
else
    echo -e "${RED}  ✗ copilot-api 未运行！请先启动：${NC}"
    echo "    docker compose up -d"
    echo "    或: bun run start"
    exit 1
fi

# ---- 2. 绕过本地代理 ----
echo -e "${YELLOW}[2/4] 配置代理绕过...${NC}"
export NO_PROXY="localhost,127.0.0.1,${NO_PROXY:-}"
echo -e "${GREEN}  ✓ NO_PROXY 已设置，localhost 请求将绕过代理${NC}"

# ---- 3. 选择工具 ----
echo ""
echo -e "${YELLOW}[3/4] 选择要启动的工具：${NC}"
echo "  1) Claude Code  (Anthropic Messages API)"
echo "  2) Codex CLI    (OpenAI Chat Completions API)"
echo ""
read -p "请选择 [1/2]: " TOOL_CHOICE

case "$TOOL_CHOICE" in
    1)
        # ============================================================
        # Claude Code 配置
        # ============================================================
        echo ""
        echo -e "${YELLOW}[4/4] 配置 Claude Code...${NC}"
        echo ""
        echo "可用的 Claude/大模型："
        echo "  1) claude-opus-4.6       (最强)"
        echo "  2) claude-opus-4.6-fast  (快速)"
        echo "  3) claude-sonnet-4.6"
        echo "  4) claude-sonnet-4.5"
        echo "  5) claude-sonnet-4"
        echo "  6) claude-opus-4.5"
        echo "  7) gpt-5.2"
        echo "  8) gpt-5.1"
        echo ""
        read -p "选择主模型 [1-8，默认 1]: " MODEL_CHOICE
        
        case "${MODEL_CHOICE:-1}" in
            1) MAIN_MODEL="claude-opus-4.6" ;;
            2) MAIN_MODEL="claude-opus-4.6-fast" ;;
            3) MAIN_MODEL="claude-sonnet-4.6" ;;
            4) MAIN_MODEL="claude-sonnet-4.5" ;;
            5) MAIN_MODEL="claude-sonnet-4" ;;
            6) MAIN_MODEL="claude-opus-4.5" ;;
            7) MAIN_MODEL="gpt-5.2" ;;
            8) MAIN_MODEL="gpt-5.1" ;;
            *) MAIN_MODEL="claude-opus-4.6" ;;
        esac
        
        echo ""
        echo "可用的轻量模型（用于后台任务）："
        echo "  1) claude-haiku-4.5"
        echo "  2) gpt-4.1"
        echo "  3) gpt-5-mini"
        echo "  4) gpt-4o-mini"
        echo ""
        read -p "选择轻量模型 [1-4，默认 1]: " SMALL_MODEL_CHOICE
        
        case "${SMALL_MODEL_CHOICE:-1}" in
            1) SMALL_MODEL="claude-haiku-4.5" ;;
            2) SMALL_MODEL="gpt-4.1" ;;
            3) SMALL_MODEL="gpt-5-mini" ;;
            4) SMALL_MODEL="gpt-4o-mini" ;;
            *) SMALL_MODEL="claude-haiku-4.5" ;;
        esac

        # 检查 claude 是否安装
        if ! command -v claude &> /dev/null; then
            echo ""
            echo -e "${YELLOW}Claude Code 未安装，正在安装...${NC}"
            npm install -g @anthropic-ai/claude-code
        fi

        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  启动 Claude Code${NC}"
        echo -e "${GREEN}  主模型: ${MAIN_MODEL}${NC}"
        echo -e "${GREEN}  轻量模型: ${SMALL_MODEL}${NC}"
        echo -e "${GREEN}  API地址: ${PROXY_URL}${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""

        export ANTHROPIC_BASE_URL="${PROXY_URL}"
        export ANTHROPIC_AUTH_TOKEN="dummy"
        export ANTHROPIC_MODEL="${MAIN_MODEL}"
        export ANTHROPIC_DEFAULT_SONNET_MODEL="${MAIN_MODEL}"
        export ANTHROPIC_SMALL_FAST_MODEL="${SMALL_MODEL}"
        export ANTHROPIC_DEFAULT_HAIKU_MODEL="${SMALL_MODEL}"
        export DISABLE_NON_ESSENTIAL_MODEL_CALLS="1"
        export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"

        exec claude
        ;;
        
    2)
        # ============================================================
        # Codex CLI 配置
        # ============================================================
        echo ""
        echo -e "${YELLOW}[4/4] 配置 Codex CLI...${NC}"
        echo ""
        echo "可用的模型："
        echo "  1) gpt-5.3-codex    (最新)"
        echo "  2) gpt-5.2-codex"
        echo "  3) gpt-5.1-codex"
        echo "  4) gpt-5.1-codex-mini"
        echo "  5) gpt-5.1-codex-max"
        echo "  6) gpt-5.2"
        echo "  7) gpt-5.1"
        echo "  8) claude-opus-4.6"
        echo ""
        read -p "选择模型 [1-8，默认 1]: " CODEX_MODEL_CHOICE
        
        case "${CODEX_MODEL_CHOICE:-1}" in
            1) CODEX_MODEL="gpt-5.3-codex" ;;
            2) CODEX_MODEL="gpt-5.2-codex" ;;
            3) CODEX_MODEL="gpt-5.1-codex" ;;
            4) CODEX_MODEL="gpt-5.1-codex-mini" ;;
            5) CODEX_MODEL="gpt-5.1-codex-max" ;;
            6) CODEX_MODEL="gpt-5.2" ;;
            7) CODEX_MODEL="gpt-5.1" ;;
            8) CODEX_MODEL="claude-opus-4.6" ;;
            *) CODEX_MODEL="gpt-5.3-codex" ;;
        esac

        # 检查 codex 是否安装
        if ! command -v codex &> /dev/null; then
            echo ""
            echo -e "${YELLOW}Codex CLI 未安装，正在安装...${NC}"
            npm install -g @openai/codex
        fi

        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  启动 Codex CLI${NC}"
        echo -e "${GREEN}  模型: ${CODEX_MODEL}${NC}"
        echo -e "${GREEN}  API地址: ${PROXY_URL}${NC}"
        echo -e "${GREEN}========================================${NC}"
        echo ""

        export OPENAI_API_KEY="dummy"

        exec codex --model "${CODEX_MODEL}" \
          -c openai_base_url="${PROXY_URL}/v1" \
          --disable responses_websockets \
          --disable responses_websockets_v2
        ;;
        
    *)
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac
