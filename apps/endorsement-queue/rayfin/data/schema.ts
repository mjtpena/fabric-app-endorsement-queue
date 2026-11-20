import { AppMarker } from './AppMarker.js';
import { ChecklistAnswer } from './ChecklistAnswer.js';
import { EndorsementEvent } from './EndorsementEvent.js';
import { EndorsementRequest } from './EndorsementRequest.js';
import { Person } from './Person.js';

export type AppSchema = {
  Person: Person;
  AppMarker: AppMarker;
  EndorsementRequest: EndorsementRequest;
  ChecklistAnswer: ChecklistAnswer;
  EndorsementEvent: EndorsementEvent;
};

export const schema = [Person, AppMarker, EndorsementRequest, ChecklistAnswer, EndorsementEvent];
