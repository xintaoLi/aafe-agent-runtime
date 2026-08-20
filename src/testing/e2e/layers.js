/*
 * Tencent is pleased to support the open source community by making
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) available.
 * Copyright (C) 2021 THL A29 Limited, a Tencent company.  All rights reserved.
 * 蓝鲸智云PaaS平台 (BlueKing PaaS) is licensed under the MIT License.
 * License for 蓝鲸智云PaaS平台 (BlueKing PaaS):
 * ---------------------------------------------------
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of
 * the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

const E2E_HINT = /(^|\/)(views|pages|screens|layouts|router|routes)(\/|$)|\/page\.(tsx|jsx|js|vue)$|\/App\.(vue|tsx|jsx)$/i;
const COMPONENT_HINT = /(^|\/)(components|widgets)(\/|$)|\.(vue|svelte)$|\.(tsx|jsx)$/i;
const UNIT_HINT = /(^|\/)(utils|util|helpers|lib|store|stores|services|service|api|apis|hooks|composables|constants|models|schema)(\/|$)/i;
const STYLE_ONLY = /\.(css|less|scss|sass|styl)$/i;
const NON_CODE = /\.(md|mdx|txt|rst|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|snap)$/i;
const NON_CODE_NAME = /(^|\/)(LICENSE|CHANGELOG|\.gitignore|\.editorconfig|\.npmrc)$/i;
const FRONTEND = /\.(vue|tsx|jsx|svelte|css|less|scss|sass)$|(^|\/)(src|app|pages|views|components)\//;

/**
 * Classify changed files into the smallest sufficient test layer.
 *
 * @param {Array<string|{path:string}>} files
 */
export function planTestLayers(files = []) {
  const e2e = [];
  const component = [];
  const unit = [];
  const nonCode = [];

  for (const item of files) {
    const filePath = String(typeof item === 'string' ? item : item?.path ?? '').replaceAll('\\', '/');
    if (!filePath) continue;
    if (isNonCodePath(filePath)) nonCode.push(filePath);
    else if (E2E_HINT.test(filePath)) e2e.push(filePath);
    else if (STYLE_ONLY.test(filePath)) component.push(filePath);
    else if (UNIT_HINT.test(filePath)) unit.push(filePath);
    else if (COMPONENT_HINT.test(filePath)) component.push(filePath);
    else if (FRONTEND.test(filePath)) component.push(filePath);
    else unit.push(filePath);
  }

  const plan = {
    e2e: unique(e2e),
    component: unique(component),
    unit: unique(unit),
    nonCode: unique(nonCode),
    primary: 'none',
    reason: '',
    routeToUnitChain: false
  };

  if (plan.e2e.length > 0) {
    plan.primary = 'e2e';
    plan.reason = `变更命中页面 / 路由文件 ${plan.e2e.slice(0, 5).join(', ')}，需真实浏览器轨迹证明。`;
  } else if (plan.component.length > 0) {
    plan.primary = 'component';
    plan.reason = `变更集中在组件与样式 ${plan.component.slice(0, 5).join(', ')}，优先组件 / 集成测试。`;
  } else if (plan.unit.length > 0) {
    plan.primary = 'unit';
    plan.reason = `变更为纯逻辑 / store / api ${plan.unit.slice(0, 5).join(', ')}，走逻辑单元测试链路。`;
    plan.routeToUnitChain = true;
  } else if (plan.nonCode.length > 0) {
    plan.primary = 'none';
    plan.reason = '变更仅为文档或静态资源，无需自动化测试。';
  }

  return plan;
}

export function shouldRouteToUnitChain(layers) {
  return layers?.routeToUnitChain === true || layers?.primary === 'unit';
}

function isNonCodePath(filePath) {
  return NON_CODE.test(filePath) || NON_CODE_NAME.test(filePath);
}

function unique(list) {
  return [...new Set(list)];
}
