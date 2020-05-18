import { getOptions, OptionObject } from 'loader-utils';
import validateOptions from 'schema-utils';
import { JSONSchema7 } from 'schema-utils/declarations/validate';
import { parse } from '@babel/parser';
import traverse, { NodePath, Binding } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { loader } from 'webpack';

function tryParse(source: string, options: OptionObject): { ast?: t.File; done: boolean } {
  try {
    return {
      // TODO maybe replace sourceType to unambiguous
      // TODO minimal plugins setup
      ast: parse(source, {
        sourceType: 'module',
        plugins: ['classProperties', 'decorators-legacy', 'jsx', 'typescript'],
      }),
      done: true,
    };
  } catch (error) {
    if (options.debug) console.log(error);
    return { done: false };
  }
}

function getPropertyPath(path: NodePath<t.ObjectExpression>, name: string): NodePath<t.ObjectProperty> | undefined {
  const propertyPath = path
    .get('properties')
    .find((propPath) => propPath.isObjectProperty() && t.isIdentifier(propPath.node.key, { name }));
  return propertyPath?.isObjectProperty() ? propertyPath : undefined;
}

function getKindObjectNodePath<T>(path: NodePath<T>): NodePath<t.ObjectExpression> | undefined {
  if (path.isObjectExpression() && getPropertyPath(path, 'title')) {
    return path;
  } else if (path.isIdentifier()) {
    const { path: bindingPath } = path.scope.getBinding(path.node.name) ?? {};
    if (!bindingPath?.isVariableDeclarator()) return;
    const initPath = bindingPath.get('init');
    if (Array.isArray(initPath)) return;
    return getKindObjectNodePath(initPath);
  }
}

function replaceStoryFnToNoop(declarations: t.VariableDeclarator[]): void {
  declarations.forEach((declarator) => (declarator.init = t.arrowFunctionExpression([], t.blockStatement([]))));
}

function getStoryObjectNodePath<T>(
  path: NodePath<T>,
  declarations: t.VariableDeclarator[],
): NodePath<t.ObjectExpression> | undefined {
  let storyObjectPath: NodePath<t.ObjectExpression> | undefined;

  declarations
    .map(({ id }) => id)
    .some((id) => {
      if (!t.isIdentifier(id)) return;
      const { referencePaths } = path.scope.getBinding(id.name) ?? {};
      const assignmentPath = referencePaths?.find(
        (refPath) =>
          refPath.parentPath.isMemberExpression() &&
          t.isIdentifier(refPath.parentPath.node.property, { name: 'story' }),
      )?.parentPath.parentPath;
      if (!assignmentPath?.isAssignmentExpression()) return;
      const rightPath = assignmentPath.get('right') as NodePath;
      if (!rightPath?.isObjectExpression()) return;
      return (storyObjectPath = rightPath);
    });
  return storyObjectPath;
}

function recursivelyRemoveUnreferencedBindings(path: NodePath<t.Program>): void {
  const getUnreferencedBindings = (): Binding[] => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    // NOTE I don't know what this method do, but it allow get correct bindings
    path.scope.crawl();
    return Object.values(path.scope.bindings).filter(
      (binding) =>
        !binding.referenced ||
        binding.referencePaths.every(
          (refPath) =>
            refPath.find((x) => x.node == binding.path.node) ||
            // NOTE Find `FunctionComponent.prop = ...` expressions
            // TODO list of func component props
            // NOTE (!!!) dangerous transformation
            (refPath.parentPath.isMemberExpression() && refPath.scope.block == path.node),
        ),
    );
  };
  let bindings = getUnreferencedBindings();
  do {
    bindings.forEach((binding) => {
      binding.referencePaths.forEach(
        (refPath) =>
          refPath.parentPath.isMemberExpression() &&
          refPath.scope.block == path.node &&
          refPath.findParent((parentPath) => !parentPath.isMemberExpression()).remove(),
      );
      binding.path.remove();
    });
  } while ((bindings = getUnreferencedBindings()).length > 0);
}

function minifyStories(ast: t.File, source: string): string {
  let isTransformed = false;
  const visited = new Set();

  traverse(ast, {
    ExportDefaultDeclaration(defaultPath) {
      const defaultDeclaration = defaultPath.get('declaration');
      const kindPath = getKindObjectNodePath(defaultDeclaration);
      if (!kindPath) return;
      isTransformed = true;
      getPropertyPath(kindPath, 'component')?.remove();
      getPropertyPath(kindPath, 'decorators')?.remove();
      const parametersPath = getPropertyPath(kindPath, 'parameters')?.get('value');
      // TODO Tests
      if (parametersPath?.isObjectExpression()) {
        // TODO define list of excluded props
        getPropertyPath(parametersPath, 'component')?.remove();
        getPropertyPath(parametersPath, 'subcomponents')?.remove();
      }
      defaultPath.parentPath.traverse({
        ExportNamedDeclaration(namedPath) {
          const { declaration: namedDeclaration } = namedPath.node;
          if (!t.isVariableDeclaration(namedDeclaration)) return;
          replaceStoryFnToNoop(namedDeclaration.declarations);
          const storyPath = getStoryObjectNodePath(namedPath, namedDeclaration.declarations);
          if (!storyPath) return;
          getPropertyPath(storyPath, 'decorators')?.remove();
        },
      });
    },
    CallExpression(path) {
      // TODO Tests
      if (path.get('callee').isIdentifier({ name: 'addDecorator' })) {
        isTransformed = true;
        path.remove();
        return;
      }
      // TODO Tests
      if (path.get('callee').isIdentifier({ name: 'addParameters' })) {
        const [argPath] = path.get('arguments');
        if (!argPath || !argPath.isObjectExpression()) return;
        isTransformed = true;
        (argPath.get('properties') as NodePath[])
          .filter((propPath) => !propPath.isObjectProperty() || !t.isIdentifier(propPath.node.key, { name: 'creevey' }))
          .forEach((propPath) => propPath.remove());
        return;
      }
      if (!path.get('callee').isIdentifier({ name: 'storiesOf' }) || visited.has(path)) return;
      isTransformed = true;
      visited.add(path);
      let callPath = path as NodePath;
      do {
        const childCallPath = callPath;
        const { parentPath: memberPath } = childCallPath;
        const propPath = memberPath.get('property') as NodePath;
        callPath = memberPath.parentPath;
        if (!memberPath.isMemberExpression() || !callPath.isCallExpression()) return;
        if (propPath.isIdentifier({ name: 'add' })) {
          const [, storyPath, parametersPath] = callPath.get('arguments') as NodePath[];
          storyPath.replaceWith(t.arrowFunctionExpression([], t.blockStatement([])));
          if (parametersPath?.isObjectExpression()) getPropertyPath(parametersPath, 'decorators')?.remove();
        }
        if (propPath.isIdentifier({ name: 'addDecorator' })) {
          callPath.replaceWith(childCallPath);
        }
      } while (callPath.parentPath != null);
    },
  });

  if (isTransformed) {
    traverse(ast, {
      TSInterfaceDeclaration(path) {
        path.remove();
      },
      Program: {
        exit(path) {
          recursivelyRemoveUnreferencedBindings(path);

          path.traverse({
            ImportDeclaration(path) {
              if (path.node.specifiers.length == 0) path.remove();
            },
          });
        },
      },
    });

    return generate(ast, { retainLines: true }).code;
  }

  return source;
}

const schema: JSONSchema7 = {
  type: 'object',
  properties: {
    debug: { type: 'boolean' },
  },
};

export default function (this: loader.LoaderContext | void, source: string): string {
  const options = this ? getOptions(this) : { debug: false };
  validateOptions(schema, options, { name: 'Creevey Stories Loader' });
  const { ast, done } = tryParse(source, options);

  if (!done || !ast) return source;

  try {
    return minifyStories(ast, source);
  } catch (error) {
    if (options.debug) console.log(error);
    // TODO Debug output
    return source;
  }
}
