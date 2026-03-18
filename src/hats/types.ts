export enum HatType {
  White = 'white',
  Red = 'red',
  Black = 'black',
  Yellow = 'yellow',
  Green = 'green',
  Blue = 'blue',
}

export interface HatDefinition {
  type: HatType;
  label: string;
  coreTrait: string;
  thinkingStyle: string;
  communicationTone: string;
  directives: string[];
  avoidances: string[];
  teamRole: string;
}
